export function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(value));
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

export function formatLeaderboardScore(value) {
  let number = Number(value || 0);
  if (!Number.isFinite(number)) return "—";
  let suffix = "";
  // 沿用地图 common/math.lua 的单位门槛，后台统一保留两位小数。
  for (const [threshold, divisor, unit] of [
    [1e13, 1e12, "兆"],
    [1e9, 1e8, "亿"],
    [1e7, 1e4, "万"],
  ]) {
    if (Math.round(Math.abs(number)) >= threshold) {
      number /= divisor;
      suffix = unit;
      break;
    }
  }
  return `${number.toFixed(2)}${suffix}`;
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
