"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, episodeHref, formatTime, type YouTubeChannel } from "@/lib/api";
import { IconX } from "@/components/icons";
import { Btn, ErrorBar, IconBtn, Spinner } from "@/components/ui";

function views(n: number | null) {
  if (!n) return null;
  return n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)} 万次播放` : `${n} 次播放`;
}

/** A YouTube channel's latest videos, to pick the next one from the same show (narrow listening). */
export default function ChannelVideos({ url, onClose }: { url: string; onClose: () => void }) {
  const router = useRouter();
  const [channel, setChannel] = useState<YouTubeChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    api
      .youtubeChannel(url)
      .then(setChannel)
      .catch((e: Error) => setError(e.message));
  }, [url]);

  const importVideo = async (videoId: string) => {
    setImporting(videoId);
    setError(null);
    try {
      const ep = await api.importEpisode(videoId);
      router.push(episodeHref(ep.id));
    } catch (e) {
      setError((e as Error).message);
      setImporting(null);
    }
  };

  return (
    <div className="glass overflow-hidden rounded-3xl">
      <div className="flex items-center gap-3 p-3 sm:p-4">
        {channel?.image && (
          // YouTube's avatar host refuses requests that carry another site as the referrer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={channel.image} alt="" referrerPolicy="no-referrer" className="size-11 shrink-0 rounded-full object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{channel?.title ?? "YouTube 频道"}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            {channel ? `最新 ${channel.videos.length} 个视频` : <><Spinner className="size-3" /> 加载中</>}
          </div>
        </div>
        <IconBtn label="收起" onClick={onClose} className="size-9">
          <IconX className="size-4" />
        </IconBtn>
      </div>
      {error && (
        <div className="px-3 pb-3">
          <ErrorBar message={error} onClose={() => setError(null)} />
        </div>
      )}
      {channel && (
        <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto border-t border-border">
          {channel.videos.length === 0 && <li className="p-4 text-sm text-muted">这个频道没有视频。</li>}
          {channel.videos.map((v) => (
            <li key={v.video_id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`}
                alt=""
                loading="lazy"
                className="aspect-video w-24 shrink-0 rounded-xl bg-fill object-cover sm:w-28"
              />
              <div className="min-w-0 flex-1 text-sm">
                <div className="line-clamp-2 font-medium leading-snug">{v.title}</div>
                <div className="mt-0.5 text-xs text-subtle">
                  {[v.duration ? formatTime(v.duration) : null, views(v.views)].filter(Boolean).join(" · ")}
                </div>
              </div>
              {v.episode_id ? (
                <Btn small onClick={() => router.push(episodeHref(v.episode_id!))}>
                  去练习
                </Btn>
              ) : (
                <Btn small primary onClick={() => importVideo(v.video_id)} disabled={importing !== null}>
                  {importing === v.video_id ? "导入中…" : "导入"}
                </Btn>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
