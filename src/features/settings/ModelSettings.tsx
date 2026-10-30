import { useEffect, useState } from "react";
import type {
  ModelSelection,
  ModelSettingsView,
  ReasoningEffort,
} from "../../../shared/model-settings";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { requestJson, errorText } from "../../lib/api";

const effortLabels: Record<ReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
  ultra: "Ultra",
};

export function ModelSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const [data, setData] = useState<ModelSettingsView | null>(null);
  const [draft, setDraft] = useState<ModelSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void requestJson<ModelSettingsView>(
      "/api/model-settings",
      { signal: controller.signal },
      { timeoutMs: 30000 },
    )
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
        setDraft(next.selection);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(errorText(failure));
      });
    return () => controller.abort();
  }, [reload]);
  const selectedModel = data?.models.find((model) => model.id === draft?.model);
  const valid = draft && selectedModel?.efforts.includes(draft.reasoningEffort);
  const changed =
    draft?.model !== data?.selection.model ||
    draft?.reasoningEffort !== data?.selection.reasoningEffort;
  async function save() {
    if (!draft || busy || !valid) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await requestJson<ModelSettingsView>("/api/model-settings", {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      setData(next);
      setDraft(next.selection);
      setMessage("Model preferences saved.");
      await onSaved();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card as="section" className="settings-form model-settings">
      <h3>Ari’s model</h3>
      {data && draft ? (
        <>
          <div className="two-fields">
            <div className="form-field">
              <label htmlFor="ari-model">Model</label>
              <Select
                id="ari-model"
                value={draft.model}
                disabled={busy}
                options={[
                  ...(!selectedModel
                    ? [
                      {
                        value: draft.model,
                        label: `${draft.model} (unavailable)`,
                        disabled: true,
                      },
                    ]
                    : []),
                  ...data.models.map((model) => ({
                    value: model.id,
                    label: model.name,
                    badge: model.id === "gpt-6-astra" ? "Recommended" : undefined,
                  })),
                ]}
                onValueChange={(model) => {
                  const option = data.models.find((item) => item.id === model)!;
                  setDraft({
                    model,
                    reasoningEffort: option.efforts.includes(
                      draft.reasoningEffort,
                    )
                      ? draft.reasoningEffort
                      : option.defaultEffort,
                  });
                  setMessage("");
                }}
              />
            </div>
            <div className="form-field">
              <label htmlFor="ari-effort">Reasoning effort</label>
              <Select
                id="ari-effort"
                value={draft.reasoningEffort}
                disabled={busy || !selectedModel}
                options={[
                  ...(!selectedModel?.efforts.includes(draft.reasoningEffort)
                    ? [
                      {
                        value: draft.reasoningEffort,
                        label: `${effortLabels[draft.reasoningEffort]} (unavailable)`,
                        disabled: true,
                      },
                    ]
                    : []),
                  ...(selectedModel?.efforts ?? []).map((effort) => ({
                    value: effort,
                    label: effortLabels[effort],
                    badge:
                      draft.model === "gpt-6-astra" &&
                      (effort === "medium" || effort === "high")
                        ? "Recommended"
                        : undefined,
                  })),
                ]}
                onValueChange={(reasoningEffort) => {
                  setDraft({
                    ...draft,
                    reasoningEffort: reasoningEffort as ReasoningEffort,
                  });
                  setMessage("");
                }}
              />
            </div>
          </div>
          <p className="model-settings-note">
            Applies to new requests across Ari. Running replies keep their
            current model.
          </p>
          <Button
            variant="primary"
            disabled={busy || !valid || !changed}
            loading={busy}
            onClick={() => void save()}
          >
            Save model preferences
          </Button>
          {!data.models.length && (
            <p className="status-line">
              No compatible models are available from this connection.
            </p>
          )}
        </>
      ) : (
        !error && <p role="status">Loading available models…</p>
      )}
      {message && (
        <p className="status-line" role="status">
          {message}
        </p>
      )}
      {error && (
        <div>
          <p className="page-error" role="alert">
            {error}
          </p>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload models
          </Button>
        </div>
      )}
    </Card>
  );
}
