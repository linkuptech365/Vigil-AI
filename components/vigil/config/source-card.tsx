"use client"

import * as React from "react"
import { Clock, FolderSearch, FolderUp, HardDrive } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { FOLDER_CHIPS, VIDEO_FORMATS } from "@/lib/vigil/data"
import { useVigil } from "../vigil-provider"

export function SourceCard() {
  const { settings, updateSettings, scanning, scanFolder, lastScan, importLocalFiles } =
    useVigil()
  const pickerRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    pickerRef.current?.setAttribute("webkitdirectory", "")
    pickerRef.current?.setAttribute("directory", "")
  }, [])

  const toggleFormat = (ext: string, checked: boolean) => {
    const next = checked
      ? [...settings.formats, ext]
      : settings.formats.filter((f) => f !== ext)
    updateSettings({ formats: VIDEO_FORMATS.filter((f) => next.includes(f)) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="size-4 text-primary" aria-hidden="true" />
          视频源与目录扫描
        </CardTitle>
        <CardDescription>
          指定监控录像所在目录，同步后视频将自动加入检测队列。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="folder-path">目标视频目录</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <InputGroup className="flex-1">
                <InputGroupAddon>
                  <FolderSearch aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="folder-path"
                  spellCheck={false}
                  placeholder="/data/videos/surveillance_stream"
                  value={settings.folderPath}
                  onChange={(event) => updateSettings({ folderPath: event.target.value })}
                  className="font-mono"
                />
              </InputGroup>
              <Button variant="outline" onClick={() => pickerRef.current?.click()}>
                <FolderUp data-icon="inline-start" />
                选择本机文件夹
              </Button>
              <input
                ref={pickerRef}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  void importLocalFiles(event.target.files)
                  event.target.value = ""
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {FOLDER_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => updateSettings({ folderPath: chip })}
                  className="rounded-md border border-border bg-secondary px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {chip}
                </button>
              ))}
            </div>
            <FieldDescription>
              浏览器无法直接读取服务器路径；使用「选择本机文件夹」可载入本机视频的真实元数据。
            </FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <Switch
              id="recursive"
              checked={settings.recursive}
              onCheckedChange={(checked) => updateSettings({ recursive: checked })}
            />
            <FieldLabel htmlFor="recursive">递归扫描子目录</FieldLabel>
          </Field>

          <Field>
            <FieldLabel>视频格式</FieldLabel>
            <div className="flex flex-wrap gap-4">
              {VIDEO_FORMATS.map((ext) => (
                <label
                  key={ext}
                  htmlFor={`fmt-${ext}`}
                  className="flex cursor-pointer items-center gap-2 font-mono text-sm"
                >
                  <Checkbox
                    id={`fmt-${ext}`}
                    checked={settings.formats.includes(ext)}
                    onCheckedChange={(checked) => toggleFormat(ext, checked === true)}
                  />
                  {ext}
                </label>
              ))}
            </div>
          </Field>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button onClick={scanFolder} disabled={scanning}>
              {scanning ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FolderSearch data-icon="inline-start" />
              )}
              {scanning ? "正在扫描目录..." : "同步并扫描目录"}
            </Button>
            {lastScan && (
              <Badge variant="outline" className="gap-1.5 font-mono text-muted-foreground">
                <Clock aria-hidden="true" />
                上次同步 {lastScan}
              </Badge>
            )}
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
