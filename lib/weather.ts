/**
 * Open-Meteo API を使用して天気を取得するユーティリティ
 * APIキー不要・無料
 */

export async function fetchWeather(date: string, location?: string) {
  const lat = 35.6895;
  const lon = 139.6917;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max&timezone=Asia%2FTokyo&start_date=${date}&end_date=${date}`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.daily) {
      const code = data.daily.weather_code[0];
      const temp = data.daily.temperature_2m_max[0];
      
      // WMO Weather interpretation codes (WW)
      let weather = "不明";
      if (code === 0) weather = "晴";
      else if (code <= 3) weather = "曇";
      else if (code >= 51 && code <= 67) weather = "雨";
      else if (code >= 71 && code <= 77) weather = "雪";
      else if (code >= 80) weather = "雨";
      
      return { weather, temperature: temp };
    }
  } catch (e) {
    console.error("Weather fetch failed", e);
  }
  return null;
}
