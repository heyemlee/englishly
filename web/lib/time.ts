// Backend timestamps are 'YYYY-MM-DD HH:MM:SS' in UTC.
export function parseStamp(stamp: string) {
  return new Date(stamp.replace(" ", "T") + "Z");
}

export function untilText(stamp: string) {
  const minutes = (parseStamp(stamp).getTime() - Date.now()) / 60000;
  if (minutes <= 1) return "现在";
  if (minutes < 60) return `${Math.round(minutes)} 分钟后`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时后`;
  return `${Math.round(minutes / 60 / 24)} 天后`;
}

export function dateText(stamp: string) {
  return parseStamp(stamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
