export interface Content {
  id: number;
  content_type: 'MOVIE' | 'IMAGE' | 'PDF' | 'HTML' | string;
  file_url: string;
  duration: number;
  orientation: 'portrait' | 'landscape';
  name: string;
  thumbnail: string;
}

export interface Playlist {
  id: number;
  name: string;
  duration: number;
  contents: Content[];
  start_date: string;
  end_date: string;
}

export interface Device {
  id: number;
  device_model_name: string;
  orientation: 'portrait' | 'landscape';
  organization: string;
  organization_type: string;
  playlists: Playlist[];
  title: string;
}

export interface User {
  id: number;
  organization: string;
  organization_type: string;
}