export default async function handler(req, res) {
  const { from, to, limit = 4 } = req.query;

  if (!from) {
    return res.status(400).json({ error: "Missing 'from' parameter." });
  }

  const fromCrs = from.toUpperCase();
  const toCrs = to ? to.toUpperCase() : null;
  const maxUpcoming = parseInt(limit, 10) || 4;
  const token = process.env.RTT_TOKEN;

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');

  if (!token) {
    return res.status(200).json({
      departed: [],
      upcoming: [],
      isMock: true,
      message: "NO API TOKEN CONFIGURED — ADD RTT_TOKEN IN VERCEL ENV VARS FOR LIVE DATA"
    });
  }

  try {
    let url = `https://data.rtt.io/api/v1/json/search/${fromCrs}`;
    if (toCrs) url += `/to/${toCrs}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'User-Agent': 'CLI-Trains-PWA/1.0'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`RTT ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();

    if (!data.services || data.services.length === 0) {
      return res.status(200).json({ departed: [], upcoming: [], isMock: false });
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

    return res.status(200).json({
      departed: departed.slice(-2),
      upcoming: upcomingAll.slice(0, maxUpcoming),
      isMock: false
    });

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
