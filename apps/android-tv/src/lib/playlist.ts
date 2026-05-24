type AnyObject = Record<string, any>;

export type NativeContentItem = {
  url: string;
  type: "image" | "video";
  duration?: number;
  title?: string;
  [key: string]: unknown;
};

function getDevicesArray(res: AnyObject): AnyObject[] {
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.devices)) return res.devices;
  if (Array.isArray(res?.data?.data)) return res.data.data;
  return [];
}

function getContentUrl(content: AnyObject): string {
  if (!content) return "";

  if (content.file_url) return String(content.file_url);
  if (content.url) return String(content.url);
  if (content.path) return String(content.path);
  if (content.file?.url) return String(content.file.url);

  if (content.file?.data?.attributes?.url) {
    return String(content.file.data.attributes.url);
  }

  if (content.attributes?.file?.data?.attributes?.url) {
    return String(content.attributes.file.data.attributes.url);
  }

  return "";
}

function getContentType(content: AnyObject, url: string): "image" | "video" {
  const rawType = String(
    content?.type || content?.content_type || content?.mime || "",
  ).toLowerCase();

  const lowerUrl = String(url || "").toLowerCase();

  if (rawType.includes("video") || rawType === "movie") return "video";
  if (rawType.includes("image")) return "image";

  if (
    lowerUrl.includes(".mp4") ||
    lowerUrl.includes(".mov") ||
    lowerUrl.includes(".webm") ||
    lowerUrl.includes(".m4v")
  ) {
    return "video";
  }

  return "image";
}

export function extractContentsForDevice(
  res: unknown,
  deviceId: string,
): NativeContentItem[] {
  const devices = getDevicesArray(res as AnyObject);

  const matchedDevice = devices.find(
    (device) => String(device?.id) === String(deviceId),
  );

  if (!matchedDevice || !Array.isArray(matchedDevice.playlists)) {
    return [];
  }

  const result: NativeContentItem[] = [];

  for (const playlist of matchedDevice.playlists) {
    const playlistDuration = Number(playlist?.duration || 5);
    const playlistContents = Array.isArray(playlist?.contents)
      ? playlist.contents
      : [];

    for (const originalItem of playlistContents) {
      const url = getContentUrl(originalItem);
      const type = getContentType(originalItem, url);

      if (!url) continue;

      result.push({
        ...originalItem,
        url,
        type,
        duration: Number(originalItem?.duration || playlistDuration || 5),
      });
    }
  }

  return result;
}