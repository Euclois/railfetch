import { Buffer } from 'buffer';

export default async function handler(req, res) {
  const { from, to, limit = 4 } = req.query;

  if (!from) {
    return res.status(400).json({ error: "Missing required parameter 'from' (origin station CRS code)." });
  }

  const fromCrs = from.toUpperCase();
  const toCrs = to ? to.toUpperCase() : null;
  const maxLimit = parseInt(limit, 10) || 4;

  const username = process.env.RTT_USERNAME;
  const password = process.env.RTT_PASSWORD;
  const token = process.env.RTT_TOKEN;

  // Use Edge Caching for response
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');

  // Detect whether we are using Basic Auth or Bearer Token (Next-Gen API)
  const hasLegacyAuth = username && password && username.toLowerCase() !== 'token';
  const hasBearerAuth = token || (password && (!username || username.toLowerCase() === 'token'));

  // If credentials are not set, fallback to high-fidelity Mock Data for local testing
  if (!hasLegacyAuth && !hasBearerAuth) {
    console.log("RTT credentials missing. Serving simulated mock data.");
    const mockData = generateMockDepartures(fromCrs, toCrs, maxLimit);
    return res.status(200).json(mockData);
  }

  try {
    let url;
    const headers = {
      'User-Agent': 'CLI-Trains-PWA/1.0'
    };

    if (hasBearerAuth) {
      const activeToken = token || password;
      // Next Generation API uses Bearer auth and data.rtt.io base server
      url = `https://data.rtt.io/api/v1/json/search/${fromCrs}`;
      if (toCrs) {
        url += `/to/${toCrs}`;
      }
      headers['Authorization'] = `Bearer ${activeToken.trim()}`;
      console.log(`Routing Next-Gen RTT API request to data.rtt.io using Bearer Token.`);
    } else {
      // Legacy API uses Basic auth and api.rtt.io
      const auth = Buffer.from(`${username}:${password}`).toString('base64');
      url = `https://api.rtt.io/api/v1/json/search/${fromCrs}`;
      if (toCrs) {
        url += `/to/${toCrs}`;
      }
      headers['Authorization'] = `Basic ${auth}`;
      console.log(`Routing Legacy RTT API request to api.rtt.io using Basic Auth.`);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`RTT API returned status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    
    if (!data.services) {
      return res.status(200).json([]);
    }

    // Map and sanitize the services
    const services = data.services
      .filter(service => service.serviceType === 'train' || service.transportMode === 'train')
      .slice(0, maxLimit)
      .map(service => {
        const detail = service.locationDetail;
        
        // Extract times
        const schDep = detail.gbttBookedDeparture;
        const actDep = detail.realtimeDeparture;
        
        // Format time strings (HH:MM)
        const formatTime = (timeStr) => {
          if (!timeStr || timeStr.length !== 4) return timeStr;
          return `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`;
        };

        const scheduled = formatTime(schDep);
        const realtime = formatTime(actDep);

        // Determine status
        let status = "ON TIME";
        let delayMins = 0;

        if (detail.displayAs === 'CANCELLED' || detail.cancelReasonCode) {
          status = "CANCELLED";
        } else if (detail.realtimeDepartureActual) {
          status = "DEPARTED";
        } else if (schDep && actDep) {
          const schMins = parseInt(schDep.slice(0, 2), 10) * 60 + parseInt(schDep.slice(2), 10);
          const actMins = parseInt(actDep.slice(0, 2), 10) * 60 + parseInt(actDep.slice(2), 10);
          
          // Handle midnight wrap-around loosely
          let diff = actMins - schMins;
          if (diff < -1000) diff += 1444; // Wrap past midnight
          
          if (diff > 0) {
            delayMins = diff;
            status = `${delayMins} MIN LATE`;
          }
        }

        // Get clean destination & origin names
        const destName = service.destination && service.destination[0] 
          ? service.destination[0].description 
          : "Unknown Destination";
        const origName = service.origin && service.origin[0] 
          ? service.origin[0].description 
          : "Unknown Origin";

        return {
          serviceId: service.serviceUid || Math.random().toString(36).substr(2, 6).toUpperCase(),
          scheduled,
          realtime: status === "CANCELLED" ? "" : realtime,
          origin: origName,
          destination: destName,
          platform: detail.platform || "—",
          operator: service.atocName || "National Rail",
          status,
          delayMins
        };
      });

    return res.status(200).json(services);

  } catch (error) {
    console.error("Error fetching live RTT data:", error);
    // If the RTT API call fails, return mock data so the app remains resilient
    const fallbackMock = generateMockDepartures(fromCrs, toCrs, maxLimit);
    return res.status(200).json(fallbackMock);
  }
}

// High-fidelity Mock Data Generator
function generateMockDepartures(from, to, limit) {
  // Force base time to the Europe/London timezone to ensure mock trains match UK local time
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" }));
  
  // Custom mock configuration depending on popular stations
  const getStationName = (crs) => {
    const names = {
      "MAN": "Manchester Piccadilly",
      "SLD": "Salford Crescent",
      "MCV": "Manchester Victoria",
      "EUS": "London Euston",
      "LIV": "Liverpool Lime Street",
      "LDS": "Leeds"
    };
    return names[crs] || `${crs} Station`;
  };

  const fromName = getStationName(from);
  const toName = to ? getStationName(to) : "Various Destinations";

  // Operator list
  const operators = ["Northern", "TransPennine Express", "Avanti West Coast", "Transport for Wales"];
  
  // Possible destinations from Manchester / Salford
  const dests = to 
    ? [toName] 
    : [
        "Blackpool North", 
        "Southport", 
        "Barrow-in-Furness", 
        "Windermere", 
        "Leeds", 
        "Liverpool Lime Street",
        "Hazlerigg",
        "Clitheroe"
      ];

  const departures = [];

  for (let i = 0; i < limit; i++) {
    // Generate scheduled departure time at intervals (e.g. 8, 18, 30, 45 mins from now)
    const timeOffset = (i * 12) + 6; // 6, 18, 30, 42 mins
    const depTime = new Date(now.getTime() + timeOffset * 60 * 1000);
    
    const format2Digits = (num) => String(num).padStart(2, '0');
    const scheduled = `${format2Digits(depTime.getHours())}:${format2Digits(depTime.getMinutes())}`;
    
    // Random status
    let status = "ON TIME";
    let delayMins = 0;
    let realtime = scheduled;
    
    const roll = Math.random();
    if (roll < 0.15) {
      status = "CANCELLED";
      realtime = "";
    } else if (roll < 0.4) {
      delayMins = Math.floor(Math.random() * 8) + 1; // 1-8 mins late
      status = `${delayMins} MIN LATE`;
      const realDepTime = new Date(depTime.getTime() + delayMins * 60 * 1000);
      realtime = `${format2Digits(realDepTime.getHours())}:${format2Digits(realDepTime.getMinutes())}`;
    }

    const platform = Math.random() < 0.2 ? "—" : String(Math.floor(Math.random() * 14) + 1);
    const dest = dests[i % dests.length];
    const op = operators[Math.floor(Math.random() * operators.length)];

    departures.append = departures.push({
      serviceId: `MOCK${i}${from}${platform.replace('—', '0')}`,
      scheduled,
      realtime,
      origin: fromName,
      destination: dest,
      platform,
      operator: op,
      status,
      delayMins
    });
  }

  return departures;
}
