// In-memory cache for the access token (persists across warm serverless invocations)
let cachedAccessToken = null;
let tokenExpiresAt = 0;
let tokenType = 'unknown'; // 'direct', 'exchange', or 'unknown'
let lastSeenToken = null;

async function performExchange(refreshToken) {
  console.log("Exchanging token ID for access token...");
  const response = await fetch('https://data.rtt.io/api/get_access_token', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${refreshToken.trim()}`,
      'User-Agent': 'CLI-Trains-PWA/1.0'
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const token = data.token || data.access_token;
  
  if (!token) {
    throw new Error(`Token exchange returned no token. Response keys: ${Object.keys(data).join(', ')}`);
  }

  const expiresIn = data.expires_in || 3600;
  cachedAccessToken = token;
  tokenExpiresAt = Date.now() + (expiresIn * 1000);
  tokenType = 'exchange';
  
  console.log(`Access token acquired, expires in ${expiresIn}s`);
  return token;
}

export default async function handler(req, res) {
  const { from, to, limit = 4 } = req.query;

  if (!from) {
    return res.status(400).json({ error: "Missing 'from' parameter." });
  }

  const fromCrs = from.toUpperCase();
  const toCrs = to ? to.toUpperCase() : null;
  const maxUpcoming = parseInt(limit, 10) || 4;
  const rttToken = process.env.RTT_TOKEN;

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');

  if (!rttToken) {
    return res.status(200).json({
      departed: [],
      upcoming: [],
      isMock: true,
      message: "NO API TOKEN CONFIGURED — ADD RTT_TOKEN IN VERCEL ENV VARS FOR LIVE DATA"
    });
  }

  // Handle token changes/rotation and resets dynamically
  if (rttToken !== lastSeenToken) {
    console.log("RTT_TOKEN changed or first run. Resetting token cache.");
    cachedAccessToken = null;
    tokenExpiresAt = 0;
    tokenType = 'unknown';
    lastSeenToken = rttToken;
  }

  let url = `https://data.rtt.io/api/v1/json/search/${fromCrs}`;
  if (toCrs) url += `/to/${toCrs}`;

  try {
    let tokenToUse = null;

    if (tokenType === 'direct') {
      tokenToUse = rttToken;
    } else if (tokenType === 'exchange') {
      if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
        tokenToUse = cachedAccessToken;
      } else {
        tokenToUse = await performExchange(rttToken);
      }
    } else {
      // 'unknown' - try using the token directly first
      tokenToUse = rttToken;
    }

    let response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokenToUse.trim()}`,
        'User-Agent': 'CLI-Trains-PWA/1.0'
      }
    });

    if (response.status === 401) {
      const errText = await response.text();
      console.log(`Access token rejected (401): ${errText}`);

      const isTokenId = errText.toLowerCase().includes("token id");

      if (tokenType === 'unknown' || isTokenId) {
        console.log("Token appears to be a token ID (or status unknown). Running exchange...");
        try {
          const freshToken = await performExchange(rttToken);
          
          const retryResponse = await fetch(url, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${freshToken}`,
              'User-Agent': 'CLI-Trains-PWA/1.0'
            }
          });

          if (!retryResponse.ok) {
            const retryErrText = await retryResponse.text();
            throw new Error(`RTT ${retryResponse.status} after token refresh: ${retryErrText.slice(0, 200)}`);
          }

          return res.status(200).json(parseServices(await retryResponse.json(), maxUpcoming));
        } catch (exchangeError) {
          throw new Error(`RTT 401: ${errText.slice(0, 200)} (Exchange also failed: ${exchangeError.message})`);
        }
      } else if (tokenType === 'exchange') {
        console.log("Cached access token expired or revoked. Forcing fresh exchange...");
        cachedAccessToken = null;
        tokenExpiresAt = 0;
        
        const freshToken = await performExchange(rttToken);
        const retryResponse = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${freshToken}`,
            'User-Agent': 'CLI-Trains-PWA/1.0'
          }
        });

        if (!retryResponse.ok) {
          const retryErrText = await retryResponse.text();
          throw new Error(`RTT ${retryResponse.status} after forced token refresh: ${retryErrText.slice(0, 200)}`);
        }

        return res.status(200).json(parseServices(await retryResponse.json(), maxUpcoming));
      } else {
        throw new Error(`RTT 401: ${errText.slice(0, 200)}`);
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`RTT ${response.status}: ${errText.slice(0, 200)}`);
    }

    if (tokenType === 'unknown') {
      console.log("Search succeeded directly. Storing tokenType as 'direct'.");
      tokenType = 'direct';
    }

    return res.status(200).json(parseServices(await response.json(), maxUpcoming));

  } catch (error) {
    console.error("RTT fetch error:", error);
    return res.status(200).json({
      departed: [],
      upcoming: [],
      isMock: true,
      message: `API ERROR: ${error.message}`
    });
  }
}

function parseServices(data, maxUpcoming) {
  if (!data.services || data.services.length === 0) {
    return { departed: [], upcoming: [], isMock: false };
  }

  const allServices = data.services
    .map(service => {
      const detail = service.locationDetail;
      if (!detail) return null;

      const schDep = detail.gbttBookedDeparture;
      const actDep = detail.realtimeDeparture;

      const fmt = (t) => {
        if (!t || t.length !== 4) return t || '';
        return `${t.slice(0, 2)}:${t.slice(2)}`;
      };

      const scheduled = fmt(schDep);
      const realtime = fmt(actDep);
      const hasDeparted = detail.realtimeDepartureActual === true;

      let status = "ON TIME";
      let delayMins = 0;

      if (detail.displayAs === 'CANCELLED_CALL' || detail.displayAs === 'CANCELLED' || detail.cancelReasonCode) {
        status = "CANCELLED";
      } else if (hasDeparted) {
        if (schDep && actDep) {
          const schM = parseInt(schDep.slice(0, 2), 10) * 60 + parseInt(schDep.slice(2), 10);
          const actM = parseInt(actDep.slice(0, 2), 10) * 60 + parseInt(actDep.slice(2), 10);
          let diff = actM - schM;
          if (diff < -720) diff += 1440;
          if (diff > 0) {
            delayMins = diff;
            status = `DEPARTED +${delayMins}`;
          } else {
            status = "DEPARTED";
          }
        } else {
          status = "DEPARTED";
        }
      } else if (schDep && actDep) {
        const schM = parseInt(schDep.slice(0, 2), 10) * 60 + parseInt(schDep.slice(2), 10);
        const actM = parseInt(actDep.slice(0, 2), 10) * 60 + parseInt(actDep.slice(2), 10);
        let diff = actM - schM;
        if (diff < -720) diff += 1440;
        if (diff > 0) {
          delayMins = diff;
          status = `${delayMins} MIN LATE`;
        }
      }

      return {
        serviceId: service.serviceUid || '',
        scheduled,
        realtime: status === "CANCELLED" ? "" : realtime,
        origin: service.origin?.[0]?.description || "",
        destination: service.destination?.[0]?.description || "",
        platform: detail.platform || "—",
        operator: service.atocName || "",
        status,
        delayMins,
        hasDeparted
      };
    })
    .filter(Boolean);

  const departed = allServices.filter(s => s.hasDeparted);
  const upcomingAll = allServices.filter(s => !s.hasDeparted);

  return {
    departed: departed.slice(-2),
    upcoming: upcomingAll.slice(0, maxUpcoming),
    isMock: false
  };
}
