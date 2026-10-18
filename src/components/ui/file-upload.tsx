import { useRef, type ReactNode } from 'react';
import { Button } from './button';
import { Input } from './input';

export function FileUpload({ label, accept, onFile, children, filename, disabled = false }: {
  label: string; accept: string; onFile: (file: File) => void; children?: ReactNode; filename?: string; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="ui-file-upload">
    <Input ref={input} type="file" hidden aria-label={label} accept={accept} disabled={disabled}
      onChange={event => {
        const file = event.target.files?.[0];
        if (file) onFile(file);
        event.currentTarget.value = '';
      }} />
    <Button variant="ghost" disabled={disabled} onClick={() => input.current?.click()}>{children || label}</Button>
    {filename && <span className="ui-file-name">{filename}</span>}
  </div>;
}
