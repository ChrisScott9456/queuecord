export function isValidURL(urlString: string): boolean {
	try {
		new URL(urlString);
		return true;
	} catch (error) {
		return false;
	}
}
