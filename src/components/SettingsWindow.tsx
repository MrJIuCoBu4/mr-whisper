import React, { useEffect, useState } from "react";

import { X } from "lucide-react";

import { useTranslation } from "react-i18next";

import { MicrophoneSettings } from "./ui/MicrophoneSettings";

import { HotkeyInput } from "./ui/HotkeyInput";

import { ActivationModeSelector } from "./ui/ActivationModeSelector";

import { Button } from "./ui/button";



type AppConfig = {

  whisperModelPath: string;

  language: string;

  hotkey: string;

  activationMode: "push-to-talk" | "tap-to-talk";

  microphoneDeviceId: string;

  preferBuiltInMic: boolean;

};



export default function SettingsWindow() {

  const { t } = useTranslation();

  const [config, setConfig] = useState<AppConfig | null>(null);

  const [hotkey, setHotkey] = useState("Alt+Z");

  const [activationMode, setActivationMode] = useState<"tap" | "push">("push");

  const [micDeviceId, setMicDeviceId] = useState("");

  const [preferBuiltInMic, setPreferBuiltInMic] = useState(true);

  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState<string | null>(null);



  useEffect(() => {

    const load = async () => {

      const result = await window.electronAPI.getConfig();

      if (result?.success && result.config) {

        const c = result.config as AppConfig;

        setConfig(c);

        setHotkey(c.hotkey || "Alt+Z");

        setActivationMode(c.activationMode === "tap-to-talk" ? "tap" : "push");

        setMicDeviceId(c.microphoneDeviceId || localStorage.getItem("selectedMicDeviceId") || "");

        setPreferBuiltInMic(c.preferBuiltInMic !== false);

      }



      const mode = await window.electronAPI.getActivationMode();

      if (mode === "tap" || mode === "push") {

        setActivationMode(mode);

      }

    };

    void load();

  }, []);



  const handleClose = () => {

    void window.electronAPI.closeSettingsWindow?.();

  };



  const handleSave = async () => {

    setSaving(true);

    setMessage(null);

    try {

      localStorage.setItem("selectedMicDeviceId", micDeviceId);

      localStorage.setItem("preferBuiltInMic", String(preferBuiltInMic));



      await window.electronAPI.updateHotkey(hotkey);

      await window.electronAPI.saveActivationMode(activationMode);



      const result = await window.electronAPI.saveConfig({

        hotkey,

        activationMode: activationMode === "tap" ? "tap-to-talk" : "push-to-talk",

        microphoneDeviceId: micDeviceId,

        preferBuiltInMic,

        whisperModelPath: config?.whisperModelPath,

        language: config?.language || "ru",

      });



      if (result?.success) {

        setMessage(t("settings.saved"));

        setTimeout(handleClose, 600);

      } else {

        setMessage(result?.error || t("settings.saveError"));

      }

    } catch (error) {

      setMessage(error instanceof Error ? error.message : t("settings.saveError"));

    } finally {

      setSaving(false);

    }

  };



  return (

    <div className="settings-window h-screen overflow-hidden bg-white text-neutral-900 flex flex-col">

      <div

        className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 shrink-0"

        style={{ WebkitAppRegion: "drag" }}

      >

        <div>

          <h1 className="text-sm font-semibold text-neutral-900">{t("settings.title")}</h1>

        </div>

        <button

          type="button"

          onClick={handleClose}

          className="w-7 h-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"

          style={{ WebkitAppRegion: "no-drag" }}

          aria-label={t("settings.close")}

        >

          <X size={14} />

        </button>

      </div>



      <div className="flex-1 overflow-hidden px-4 py-4 space-y-4">

        <section className="space-y-2">

          <h2 className="text-xs font-medium text-neutral-600">{t("settings.hotkey")}</h2>

          <HotkeyInput value={hotkey} onChange={setHotkey} />

          <ActivationModeSelector value={activationMode} onChange={setActivationMode} variant="compact" />

        </section>



        <section className="space-y-2">

          <h2 className="text-xs font-medium text-neutral-600">{t("settings.microphone")}</h2>

          <MicrophoneSettings

            preferBuiltInMic={preferBuiltInMic}

            selectedMicDeviceId={micDeviceId}

            onPreferBuiltInChange={setPreferBuiltInMic}

            onDeviceSelect={setMicDeviceId}

          />

        </section>

      </div>



      <div className="px-4 py-3 border-t border-neutral-200 shrink-0 space-y-2">

        {message && <p className="text-xs text-neutral-700 text-center">{message}</p>}

        <Button

          onClick={handleSave}

          disabled={saving}

          className="w-full h-9 bg-neutral-900 text-white hover:bg-neutral-800 border-neutral-900"

        >

          {saving ? t("settings.saving") : t("settings.save")}

        </Button>

      </div>

    </div>

  );

}

