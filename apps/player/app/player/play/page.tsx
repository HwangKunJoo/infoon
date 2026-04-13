"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Pusher from "pusher-js";
import { deviceApi } from "@/lib/api";
import { storage } from "@/lib/storage";
import { Content } from "@/types/player";

export default function PlayerPlay() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deviceId = "99";

  const [contents, setContents] = useState<Content[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pusherRef = useRef<Pusher | null>(null);
  const channelRef = useRef<any>(null);

  const clearTick = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTick = useCallback(
    (sec: number, total: number) => {
      clearTick();
      intervalRef.current = setInterval(
        () => {
          setCurrentIdx((prev) => (prev + 1) % total);
        },
        Math.max(1, sec) * 1000,
      );
    },
    [clearTick],
  );

  const fetchDeviceInfo = useCallback(
    async (id: string) => {
      const token = storage.getToken();
      if (!token) {
        router.replace("/player");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await deviceApi.get(token);
        const matched = res.data.find((d: any) => d.id === Number(id));
        const list: Content[] = matched?.playlists
          ? matched.playlists.flatMap((pl: any) =>
              pl.contents.map((c: any) => ({ ...c, duration: pl.duration })),
            )
          : [];
        setContents(list);
        setCurrentIdx(0);
      } catch {
        setError("콘텐츠를 불러오는 중 오류가 발생했습니다");
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  // 초기 로드
  useEffect(() => {
    if (!deviceId) return;
    fetchDeviceInfo(deviceId);
    return () => clearTick();
  }, [deviceId]);

  // Pusher 연결
  useEffect(() => {
    if (!deviceId) return;

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    });
    pusherRef.current = pusher;

    const channelName = `tv-control-${deviceId}`;
    const channel = pusher.subscribe(channelName);
    channelRef.current = channel;

    channel.bind("refresh", (payload: any) => {
      fetchDeviceInfo(payload.deviceId);
    });

    return () => {
      try {
        channel.unbind_all();
        pusher.unsubscribe(channelName);
        pusher.disconnect();
      } catch {}
    };
  }, [deviceId]);

  // 타이머 처리
  useEffect(() => {
    const current = contents[currentIdx];
    if (!current) {
      clearTick();
      return;
    }

    if (current.content_type === "MOVIE") {
      clearTick();
    } else {
      const duration = Number(current.duration) || 5;
      startTick(duration, contents.length);
    }

    return () => clearTick();
  }, [currentIdx, contents]);

  const handleVideoEnd = () => {
    setCurrentIdx((prev) => (prev + 1) % contents.length);
  };

  if (loading) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black">
        <p className="text-white text-lg">콘텐츠를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-black gap-4">
        <p className="text-red-400 text-lg">{error}</p>
        <button
          onClick={() => deviceId && fetchDeviceInfo(deviceId)}
          className="px-6 py-3 bg-orange-400 text-white font-bold rounded-lg"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (contents.length === 0) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black">
        <p className="text-white text-lg">저장된 플레이리스트가 없습니다</p>
      </div>
    );
  }

  const current = contents[currentIdx];

  return (
    <div className="w-screen h-screen bg-black flex items-center justify-center overflow-hidden">
      {current.content_type === "MOVIE" && (
        <video
          key={current.file_url}
          src={current.file_url}
          className="w-full h-full object-cover"
          autoPlay
          playsInline
          onEnded={handleVideoEnd}
        />
      )}

      {current.content_type === "IMAGE" && (
        <img
          key={current.file_url}
          src={current.file_url}
          className="w-full h-full object-cover"
          alt={current.name}
        />
      )}

      {current.content_type === "PDF" && (
        <iframe
          key={current.file_url}
          src={current.file_url}
          className="w-full h-full"
        />
      )}
    </div>
  );
}
