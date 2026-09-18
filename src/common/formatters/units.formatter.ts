// Display formatting lives on the backend so the frontend does no formatting of
// its own and the format can change later without a frontend deploy (§6).

export interface DistanceValue {
  meters: number;
  text: string;
}

export interface DurationValue {
  seconds: number;
  text: string;
}

export function formatDistance(meters: number): DistanceValue {
  if (meters < 1000) {
    return { meters, text: `${Math.round(meters)} m` };
  }
  const km = meters / 1000;
  return { meters, text: `${km.toFixed(1)} km` };
}

export function formatDuration(seconds: number): DurationValue {
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return { seconds, text: `${minutes} min` };
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds - hours * 3600) / 60);
  return { seconds, text: `${hours} hr ${minutes} min` };
}
