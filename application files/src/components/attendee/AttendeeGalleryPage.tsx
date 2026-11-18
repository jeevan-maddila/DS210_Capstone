import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, Image as ImageIcon, Lock, RefreshCw } from 'lucide-react';
import { AttendeeGallery, galleryService } from '../../services/galleryService';

interface AttendeeGalleryPageProps {
  token: string;
}

export const AttendeeGalleryPage: React.FC<AttendeeGalleryPageProps> = ({ token }) => {
  const [gallery, setGallery] = useState<AttendeeGallery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    galleryService
      .get(token)
      .then((result) => {
        if (active) setGallery(result);
      })
      .catch((requestError) => {
        if (active) setError('The gallery could not be loaded. Check your link or contact the event organizer.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-300">Opening your private gallery...</p>
        </div>
      </div>
    );
  }

  if (error || !gallery) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-slate-900">Gallery unavailable</h1>
          <p className="text-sm text-slate-500 mt-2">{error || 'This gallery link is invalid or expired.'}</p>
        </div>
      </div>
    );
  }

  const expiration = new Date(gallery.expiresAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const firstName = gallery.attendeeName.trim().split(/\s+/)[0] || 'there';

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-16">
      <header className="bg-slate-950 text-white">
        <div className="max-w-6xl mx-auto px-5 py-10 sm:py-14">
          <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold uppercase tracking-widest">
            <Lock className="w-3.5 h-3.5" /> Private gallery
          </div>
          <h1 className="text-3xl sm:text-4xl font-black mt-3">Your photos from {gallery.eventName}</h1>
          <p className="text-slate-300 mt-2">
            Hi {firstName}, we found {gallery.photos.length}{' '}
            {gallery.photos.length === 1 ? 'photo' : 'photos'} of you.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href={gallery.downloadAllUrl}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold transition"
            >
              <Download className="w-4 h-4" /> Download all as ZIP
            </a>
            <span className="text-xs text-slate-400">Link expires {expiration}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-8">
        {gallery.photos.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-12 text-center">
            <ImageIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">No photos are currently available.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {gallery.photos.map((photo) => (
              <article key={photo.id} className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                <a href={photo.viewUrl} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-slate-900">
                  <img
                    src={photo.viewUrl}
                    alt={photo.fileName}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </a>
                <div className="p-4 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-700 truncate" title={photo.fileName}>
                    {photo.fileName}
                  </span>
                  <a
                    href={photo.downloadUrl}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-black text-white text-xs font-semibold transition"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
