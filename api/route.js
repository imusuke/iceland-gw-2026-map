export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.status(200).end();
    return;
  }

  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const fromLat = Number(request.query.fromLat);
  const fromLng = Number(request.query.fromLng);
  const toLat = Number(request.query.toLat);
  const toLng = Number(request.query.toLng);

  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
    response.status(400).json({ error: "Invalid coordinates" });
    return;
  }

  try {
    const fromPoint = await fetchNearestPoint(fromLat, fromLng);
    const toPoint = await fetchNearestPoint(toLat, toLng);
    const route = await fetchRoute(fromPoint, toPoint);

    if (!route || !Array.isArray(route)) {
      response.status(502).json({ error: "Unable to build route" });
      return;
    }

    response.status(200).json({ latLngs: route });
  } catch (error) {
    response.status(502).json({
      error: "Routing failed",
      detail: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

async function fetchNearestPoint(lat, lng) {
  const url = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Nearest lookup failed: ${response.status}`);
  }

  const data = await response.json();
  const waypoint = data && data.waypoints && data.waypoints[0];
  if (!waypoint || !Array.isArray(waypoint.location)) {
    throw new Error("Nearest lookup returned no waypoint");
  }

  return {
    lat: waypoint.location[1],
    lng: waypoint.location[0]
  };
}

async function fetchRoute(fromPoint, toPoint) {
  const coordinates = `${fromPoint.lng},${fromPoint.lat};${toPoint.lng},${toPoint.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Route lookup failed: ${response.status}`);
  }

  const data = await response.json();
  const route = data && data.routes && data.routes[0];
  if (!route || !route.geometry || !Array.isArray(route.geometry.coordinates)) {
    throw new Error("Route lookup returned no geometry");
  }

  return route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}
