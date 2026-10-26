// Dates the Indian way ("26 Oct 2026", "26 Oct 2026, 4:30 pm"), in India time, whatever the
// server's or visitor's clock is set to
const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export const formatDate = (iso: string): string => date.format(new Date(iso));
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

// {"colour": "Black", "size": "M"} → "Black / M"
export const formatOptions = (options: Record<string, string>): string => Object.values(options).join(" / ");

// "1 item", "3 items"
export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
