// Single-page client for the Route to Office web app.
// Same-origin fetches only — no CORS path — the frontend is served by Nest.

interface CompanyResponse {
  name: string;
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

interface ConfigResponse {
  googleMapsBrowserKey: string;
}

interface RouteResponse {
  distance: { meters: number; text: string };
  duration: { seconds: number; text: string };
  staticDuration: { seconds: number; text: string };
  trafficDelaySeconds: number;
  polyline: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  computedAt: string;
  cached: boolean;
}

interface ApiError {
  message?: string;
}

const els = {
  officeName: document.getElementById('office-name') as HTMLHeadingElement,
  officeAddress: document.getElementById('office-address') as HTMLParagraphElement,
  locateBtn: document.getElementById('locate-btn') as HTMLButtonElement,
  status: document.getElementById('status') as HTMLDivElement,
  result: document.getElementById('result') as HTMLElement,
  distance: document.getElementById('distance') as HTMLElement,
  duration: document.getElementById('duration') as HTMLElement,
  staticDuration: document.getElementById('static-duration') as HTMLElement,
};

let map: google.maps.Map | undefined;
let routePolyline: google.maps.Polyline | undefined;
let originMarker: google.maps.Marker | undefined;
let destinationMarker: google.maps.Marker | undefined;
let company: CompanyResponse | undefined;

async function boot(): Promise<void> {
  setStatus('กำลังโหลดการตั้งค่า…');
  try {
    const [companyData, configData] = await Promise.all([
      fetchJson<CompanyResponse>('/api/company'),
      fetchJson<ConfigResponse>('/api/config'),
    ]);
    company = companyData;
    els.officeName.textContent = company.name;
    els.officeAddress.textContent = company.address;

    await loadGoogleMaps(configData.googleMapsBrowserKey);
    renderMap(company);

    els.locateBtn.disabled = false;
    els.locateBtn.addEventListener('click', handleLocate);
    setStatus('กดปุ่มเพื่อค้นหาเส้นทางจากตำแหน่งของคุณ');
  } catch (err) {
    setStatus(messageOf(err) ?? 'โหลดการตั้งค่าไม่สำเร็จ กรุณาลองใหม่', 'error');
  }
}

async function handleLocate(): Promise<void> {
  if (!navigator.geolocation) {
    setStatus('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง', 'error');
    return;
  }
  els.locateBtn.disabled = true;
  setStatus('กำลังขอตำแหน่งของคุณ…');

  let coords: GeolocationCoordinates;
  try {
    coords = await getPositionWithRetry();
  } catch (err) {
    setStatus(geoErrorMessage(err), 'error');
    els.locateBtn.disabled = false;
    return;
  }

  setStatus('กำลังคำนวณเส้นทาง…');
  try {
    const route = await fetchJson<RouteResponse>('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
    });
    drawRoute(route);
    showResult(route);
    setStatus(route.cached ? 'ใช้ข้อมูลจากแคช (ภายใน 5 นาที)' : 'อัปเดตล่าสุดแล้ว');
  } catch (err) {
    setStatus(messageOf(err) ?? 'คำนวณเส้นทางไม่สำเร็จ', 'error');
  } finally {
    els.locateBtn.disabled = false;
  }
}

function renderMap(office: CompanyResponse): void {
  map = new google.maps.Map(document.getElementById('map') as HTMLElement, {
    center: { lat: office.lat, lng: office.lng },
    zoom: 14,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });
  destinationMarker = new google.maps.Marker({
    position: { lat: office.lat, lng: office.lng },
    map,
    title: office.name,
  });
}

function drawRoute(route: RouteResponse): void {
  if (!map) return;
  const path = google.maps.geometry.encoding.decodePath(route.polyline);

  routePolyline?.setMap(null);
  routePolyline = new google.maps.Polyline({
    path,
    map,
    strokeColor: '#2563eb',
    strokeWeight: 5,
    strokeOpacity: 0.9,
  });

  originMarker?.setMap(null);
  originMarker = new google.maps.Marker({
    position: route.origin,
    map,
    title: 'ตำแหน่งของคุณ',
  });

  const bounds = new google.maps.LatLngBounds();
  path.forEach((p) => bounds.extend(p));
  map.fitBounds(bounds, 48);
}

function showResult(route: RouteResponse): void {
  els.result.hidden = false;
  els.distance.textContent = route.distance.text;
  els.duration.textContent = route.duration.text;
  els.staticDuration.textContent = route.staticDuration.text;
}

function setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
  els.status.textContent = text;
  els.status.classList.toggle('error', kind === 'error');
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let body: ApiError = {};
    try {
      body = (await res.json()) as ApiError;
    } catch {
      // Non-JSON error body — fall through to generic message below.
    }
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function loadGoogleMaps(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }
    const callbackName = `__gmapsReady_${Date.now()}`;
    (window as unknown as Record<string, unknown>)[callbackName] = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      resolve();
    };
    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: apiKey,
      libraries: 'geometry',
      callback: callbackName,
      v: 'weekly',
      language: 'th',
      region: 'TH',
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('โหลด Google Maps ไม่สำเร็จ'));
    document.head.appendChild(script);
  });
}

function getPosition(options: PositionOptions): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => {
        console.error('geolocation error', err.code, err.message);
        reject(err);
      },
      options,
    );
  });
}

// kCLErrorLocationUnknown on macOS surfaces as POSITION_UNAVAILABLE and is
// transient by Apple's own definition — retry once with a looser accuracy
// requirement instead of failing straight to the user.
async function getPositionWithRetry(): Promise<GeolocationCoordinates> {
  try {
    return await getPosition({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 });
  } catch (err) {
    if (!isPositionUnavailable(err)) throw err;
    await delay(1500);
    return getPosition({ enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 });
  }
}

function isPositionUnavailable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err
    && (err as GeolocationPositionError).code === 2;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function geoErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as GeolocationPositionError).code;
    if (code === 1) return 'คุณปฏิเสธการเข้าถึงตำแหน่ง กรุณาอนุญาตในเบราว์เซอร์แล้วลองใหม่';
    if (code === 2) return 'ไม่สามารถระบุตำแหน่งได้ กรุณาลองใหม่';
    if (code === 3) return 'หมดเวลาในการระบุตำแหน่ง กรุณาลองใหม่';
  }
  return 'ระบุตำแหน่งไม่สำเร็จ';
}

function messageOf(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

void boot();
