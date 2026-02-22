const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(dateStr: string): string {
	const date = new Date(dateStr);
	const now = Date.now();
	const diff = now - date.getTime();

	if (diff < MINUTE) return "just now";
	if (diff < HOUR) {
		const minutes = Math.floor(diff / MINUTE);
		return `${minutes} min ago`;
	}
	if (diff < DAY) {
		const hours = Math.floor(diff / HOUR);
		return `${hours}h ago`;
	}
	const days = Math.floor(diff / DAY);
	if (days === 1) return "yesterday";
	return `${days}d ago`;
}
