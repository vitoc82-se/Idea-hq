"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SIZE = 256;

// Centre-crops the file to a square and downscales it to at most 256×256, so
// the data URL sent to the server stays small.
async function resizeToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      out,
      out
    );
    const webp = canvas.toDataURL("image/webp", 0.8);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProfilePicture({
  image,
  name,
  email,
}: {
  image?: string | null;
  name?: string | null;
  email?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setMessage(null);
    setPending(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setMessage({ ok: false, text: "That file is over 5 MB. Pick a smaller image." });
      e.target.value = "";
      return;
    }
    try {
      setPending(await resizeToDataUrl(file));
    } catch {
      setMessage({ ok: false, text: "Could not read that image." });
      e.target.value = "";
    }
  };

  const save = async (next: string | null) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error || "Could not save the picture" });
        return;
      }
      setPending(null);
      setMessage({ ok: true, text: next ? "Profile picture saved" : "Profile picture removed" });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile picture</CardTitle>
        <CardDescription>Shown next to your name in the sidebar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar image={pending ?? image} name={name} email={email} size={80} />
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="avatar">Choose an image</Label>
            <Input
              id="avatar"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFile}
              disabled={saving}
            />
          </div>
        </div>

        {message && (
          <p
            className={
              message.ok
                ? "text-sm text-emerald-600 dark:text-emerald-400"
                : "text-sm text-red-600 dark:text-red-400"
            }
          >
            {message.text}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={() => save(pending)} disabled={saving || !pending}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="outline"
            onClick={() => save(null)}
            disabled={saving || (!image && !pending)}
          >
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
