import { useEffect, useRef, useState } from 'react';
import { t } from './he';

/**
 * A note about one game, in the user's own words and their own formatting.
 *
 * "Wait for the GOTY edition." "Gift for Dana — do not buy before her
 * birthday." "Cheaper on disc at Ivory last month." A price tracker collects
 * numbers; the reason somebody is watching a game is not a number, and it was
 * living in their head.
 *
 * IT RENDERS HTML THE USER WROTE, which is the one thing in this app that could
 * be a stored XSS. It is safe because of server/src/noteHtml.ts, not because of
 * anything here: every note passes a whitelist sanitiser on the way into the
 * database — a tag not on the list is dropped, an attribute not on the list is
 * dropped, a CSS property not on the list is dropped — and notes that arrive in
 * a shared file or a pasted token go through exactly the same door. What is
 * rendered below is therefore what came back OUT of that sanitiser.
 *
 * The editor is a contenteditable rather than a pile of custom controls, which
 * is what makes the emoji picker, the clipboard and drag-and-drop work at all:
 * they are the operating system's, and the right thing to do with them is get
 * out of the way. Win+. on Windows, Ctrl+Cmd+Space on a Mac, the phone's own
 * keyboard — none of that is ours to build, and all of it works.
 */

/** Roughly what the sanitiser will keep; the real limit is enforced server-side. */
const MAX_IMAGE_BYTES = 180 * 1024;

interface Tool {
  cmd: string;
  value?: string;
  label: string;
  title: string;
  style?: string;
}

const TOOLS: Tool[] = [
  { cmd: 'bold', label: 'B', title: 'מודגש', style: 'font-weight:700' },
  { cmd: 'italic', label: 'I', title: 'נטוי', style: 'font-style:italic' },
  { cmd: 'underline', label: 'U', title: 'קו תחתון', style: 'text-decoration:underline' },
  { cmd: 'strikeThrough', label: 'S', title: 'קו חוצה', style: 'text-decoration:line-through' },
  { cmd: 'insertUnorderedList', label: '•', title: 'רשימה' },
];

export function NoteEditor({
  value,
  onSave,
  onDelete,
}: {
  value: string;
  onSave: (html: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed the editor once per note. Writing `value` into it on every render would
  // fight the cursor: React would reset the DOM under the caret on each
  // keystroke and the caret would jump to the start.
  useEffect(() => {
    if (box.current) box.current.innerHTML = value;
    setDirty(false);
    setSaved(false);
  }, [value]);

  /**
   * document.execCommand is deprecated and is still the only thing that applies
   * formatting to a selection inside a contenteditable in every browser. Its
   * replacement was never built. The alternative is a custom selection and
   * range engine, which is a large amount of code to reimplement something that
   * works, and every rich-text editor of this size makes the same call.
   */
  const run = (cmd: string, arg?: string) => {
    box.current?.focus();
    document.execCommand(cmd, false, arg);
    setDirty(true);
    setSaved(false);
  };

  const addImage = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) return;
    if (file.size > MAX_IMAGE_BYTES) {
      // Said plainly rather than silently truncated: a picture that vanishes on
      // save with no explanation is worse than one that is refused up front.
      window.alert(t.noteImageTooBig(Math.round(MAX_IMAGE_BYTES / 1024)));
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    // Inserted as an image the sanitiser will accept: a data: URL of a real
    // image type, sized so it cannot swallow the panel.
    run('insertHTML', `<img src="${dataUrl}" alt="" width="260">`);
  };

  const save = async () => {
    if (!box.current || busy) return;
    setBusy(true);
    try {
      await onSave(box.current.innerHTML);
      setDirty(false);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="note-editor">
      <div className="note-tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.cmd}
            type="button"
            className="note-tool"
            title={tool.title}
            style={tool.style ? ({ ...styleFrom(tool.style) } as React.CSSProperties) : undefined}
            onMouseDown={(e) => e.preventDefault()} // keep the selection
            onClick={() => run(tool.cmd)}
          >
            {tool.label}
          </button>
        ))}

        <label className="note-tool note-color" title={t.noteColor}>
          🎨
          <input
            type="color"
            onChange={(e) => run('foreColor', e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </label>

        <select
          className="note-size"
          title={t.noteSize}
          defaultValue=""
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (e.target.value) run('fontSize', e.target.value);
            e.target.value = '';
          }}
        >
          <option value="">{t.noteSize}</option>
          <option value="2">{t.noteSizeSmall}</option>
          <option value="3">{t.noteSizeNormal}</option>
          <option value="5">{t.noteSizeBig}</option>
        </select>

        <label className="note-tool" title={t.noteImage}>
          🖼
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void addImage(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      <div
        ref={box}
        className="note-box"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t.noteAria}
        data-placeholder={t.notePlaceholder}
        onInput={() => {
          setDirty(true);
          setSaved(false);
        }}
      />

      <div className="note-actions">
        <button className="note-save" onClick={save} disabled={busy || !dirty}>
          {busy ? t.noteSaving : saved ? t.noteSaved : t.noteSave}
        </button>
        <button
          className="note-delete"
          disabled={busy}
          onClick={async () => {
            // Confirmed, because it is somebody's own writing and there is no
            // undo for it anywhere in this app.
            if (!window.confirm(t.noteDeleteConfirm)) return;
            setBusy(true);
            try {
              await onDelete();
              if (box.current) box.current.innerHTML = '';
              setDirty(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t.noteDelete}
        </button>
        <span className="note-hint">{t.noteHint}</span>
      </div>
    </div>
  );
}

/** "font-weight:700" → { fontWeight: '700' }, for the toolbar's own buttons. */
function styleFrom(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of css.split(';')) {
    const [prop, value] = rule.split(':');
    if (!prop || !value) continue;
    out[prop.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value.trim();
  }
  return out;
}

/**
 * A saved note, rendered.
 *
 * `dangerouslySetInnerHTML` is correct here and nowhere else in this app: the
 * string comes back from the database, and nothing reaches that column without
 * passing sanitizeNote — the route, the importer and the token decoder all go
 * through the same setter. See noteHtml.ts for the whitelist.
 */
export function NoteView({ html }: { html: string }) {
  if (!html) return null;
  return <div className="note-view" dangerouslySetInnerHTML={{ __html: html }} />;
}
