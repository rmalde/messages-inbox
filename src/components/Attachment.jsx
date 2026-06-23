import React, { useEffect, useState } from 'react';

const IMG = /^image\//;

export default function Attachment({ att }) {
  const [data, setData] = useState(null);
  const isImage = IMG.test(att.mime) || /\.(jpg|jpeg|png|gif|heic|webp)$/i.test(att.path || '');

  useEffect(() => {
    let live = true;
    if (isImage && att.path) {
      window.api.attachment(att.path).then((d) => {
        if (live && d) setData(d.dataUrl);
      });
    }
    return () => { live = false; };
  }, [att.path]);

  if (isImage) {
    if (!data) return <div className="attach-file">🖼 {att.name || 'Image'}</div>;
    return <img className="attach-img" src={data} alt={att.name || 'image'} />;
  }
  return (
    <div className="attach-file">
      📎 {att.name || att.mime || 'Attachment'}
    </div>
  );
}
