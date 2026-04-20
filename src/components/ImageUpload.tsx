import { useRef } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { useToast } from '../hooks/useToast';

async function downscaleImage(file: File, maxDim = 800, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, quality));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ImageUpload({
  value,
  onChange,
  label,
  aspect = 'square',
  maxKB = 5000,
  placeholder = 'Click or drop JPG / PNG',
  maxDim,
  hint,
}: {
  value?: string | null;
  onChange: (v: string | null) => void;
  label: string;
  aspect?: 'square' | 'wide';
  maxKB?: number;
  placeholder?: string;
  maxDim?: number;
  hint?: string;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/jpg'].includes(file.type)) {
      toast('Only JPG or PNG allowed', 'error');
      return;
    }
    if (file.size > maxKB * 1024) {
      toast(`File is ${Math.round(file.size / 1024)} KB — max ${maxKB} KB. Try a smaller image.`, 'error');
      return;
    }
    try {
      const targetDim = maxDim ?? (aspect === 'wide' ? 600 : 512);
      const dataUrl = await downscaleImage(file, targetDim);
      onChange(dataUrl);
      toast('Image uploaded');
    } catch {
      toast('Failed to process image', 'error');
    }
  };

  const boxH = aspect === 'wide' ? 'h-20' : 'h-28';
  const boxW = aspect === 'wide' ? 'w-48' : 'w-28';

  return (
    <div>
      <label className="label">{label}</label>
      <div
        className={`${boxW} ${boxH} border-2 border-dashed rounded-lg flex items-center justify-center overflow-hidden relative cursor-pointer transition border-gray-300 dark:border-slate-600 hover:border-blue-400 bg-white dark:bg-slate-800`}
        onClick={() => inputRef.current?.click()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        onDragOver={(e) => e.preventDefault()}
      >
        {value ? (
          <img src={value} alt={label} className="w-full h-full object-contain" />
        ) : (
          <div className="text-[10px] text-gray-500 dark:text-slate-400 text-center p-2">
            <Upload className="w-4 h-4 mx-auto mb-1" /> {placeholder}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
      </div>
      {hint && (
        <div className="text-[10px] text-amber-700 dark:text-amber-300 mt-1 max-w-xs">
          {hint}
        </div>
      )}
      {value && (
        <button
          type="button"
          className="text-[11px] text-red-600 hover:underline mt-1 inline-flex items-center gap-1"
          onClick={() => onChange(null)}
        >
          <Trash2 className="w-3 h-3" /> Remove
        </button>
      )}
    </div>
  );
}
