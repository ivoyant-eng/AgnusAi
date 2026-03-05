import { useRef, useState } from 'react'
import { Upload, CheckCircle, X } from 'lucide-react'

interface PemUploadProps {
  value: string
  onChange: (pem: string) => void
  required?: boolean
}

export function PemUpload({ value, onChange, required }: PemUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  function readFile(file: File) {
    setError('')
    if (!file.name.endsWith('.pem') && !file.name.endsWith('.key') && file.type !== 'text/plain') {
      setError('Please upload a .pem or .key file')
      return
    }
    const reader = new FileReader()
    reader.onload = e => {
      const text = (e.target?.result as string) ?? ''
      if (!text.includes('PRIVATE KEY')) {
        setError('File does not appear to be a valid private key')
        return
      }
      onChange(text)
    }
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) readFile(file)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) readFile(file)
  }

  const fileName = value
    ? value.match(/-----BEGIN ([A-Z ]+)-----/)?.[1]?.replace(' PRIVATE KEY', '') + ' private key'
    : null

  if (value && !error) {
    return (
      <div className="flex items-center justify-between border border-border px-4 py-3 bg-muted/10">
        <div className="flex items-center gap-3 min-w-0">
          <CheckCircle className="h-4 w-4 text-[#E85A1A] shrink-0" />
          <span className="font-mono text-xs text-foreground truncate">{fileName ?? 'private-key.pem'}</span>
        </div>
        <button
          type="button"
          onClick={() => { onChange(''); if (inputRef.current) inputRef.current.value = '' }}
          className="label-meta hover:text-foreground transition-colors ml-3 shrink-0"
          aria-label="Remove"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed px-4 py-8 cursor-pointer transition-colors ${
          dragging ? 'border-foreground bg-muted/20' : 'border-border hover:border-foreground/50 hover:bg-muted/10'
        }`}
      >
        <Upload className="h-5 w-5 text-muted-foreground" />
        <p className="font-mono text-xs text-muted-foreground text-center">
          Drop your <span className="text-foreground">.pem</span> file here
          <br />
          <span className="label-meta">or click to browse</span>
        </p>
      </div>
      {error && <p className="font-mono text-xs text-destructive mt-1.5">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".pem,.key,text/plain"
        className="hidden"
        onChange={handleChange}
        required={required && !value}
      />
    </div>
  )
}
