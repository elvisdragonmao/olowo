import { ArrowLeft } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest } from "../../shared/api";

type Lookup = { scooterId: number; stationId: number; label: string | null };

/** Scan the QR code on a scooter (or type its plate) to jump straight to borrowing it. */
export function ScanView() {
	const back = useUiStore(state => state.back);
	const navigate = useUiStore(state => state.navigate);
	const [plate, setPlate] = useState("");
	const lookup = useMutation({
		mutationFn: (code: string) => apiRequest<Lookup>(`/v1/scooters/lookup?code=${encodeURIComponent(code)}`),
		onSuccess: result => navigate({ kind: "scooter", stationId: result.stationId, scooterId: result.scooterId }, { replace: true })
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (plate.trim()) lookup.mutate(plate.trim());
	};

	return (
		<>
			<header className="view-head" data-sheet-drag>
				<button type="button" className="icon-button" aria-label="返回" onClick={back}>
					<ArrowLeft size={18} weight="bold" />
				</button>
				<div className="view-head-title">
					<h2>掃碼借車</h2>
					<p>對準車頭的 QR Code</p>
				</div>
			</header>
			<div className="view-body">
				<Camera onCode={code => !lookup.isPending && lookup.mutate(code)} paused={lookup.isPending || lookup.isSuccess} />
				{lookup.error ? <p className="inline-error">{lookup.error.message}</p> : null}
				<form className="plate-form" onSubmit={submit}>
					<label className="field">
						<span>或輸入車號</span>
						<input value={plate} onChange={event => setPlate(event.target.value.toUpperCase())} placeholder="例如 JZ-333" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
					</label>
					<button type="submit" className="button button-primary" disabled={!plate.trim() || lookup.isPending}>
						{lookup.isPending ? "查詢中…" : "前往"}
					</button>
				</form>
			</div>
		</>
	);
}

type Scanner = { start: () => Promise<void>; stop: () => void; destroy: () => void };

function Camera({ onCode, paused }: { onCode: (code: string) => void; paused: boolean }) {
	const video = useRef<HTMLVideoElement>(null);
	const latest = useRef(onCode);
	latest.current = onCode;
	const scanner = useRef<Scanner | null>(null);
	const [status, setStatus] = useState<"starting" | "scanning" | "denied" | "unavailable">("starting");

	useEffect(() => {
		let disposed = false;
		// Loaded on demand: the decoder and its worker are only needed on this screen.
		void import("qr-scanner").then(async ({ default: QrScanner }) => {
			if (disposed || !video.current) return;
			if (!(await QrScanner.hasCamera())) {
				setStatus("unavailable");
				return;
			}
			const instance = new QrScanner(video.current, result => latest.current(result.data), {
				preferredCamera: "environment",
				maxScansPerSecond: 6,
				returnDetailedScanResult: true
			});
			scanner.current = instance;
			try {
				await instance.start();
				if (!disposed) setStatus("scanning");
			} catch {
				if (!disposed) setStatus("denied");
			}
		});
		return () => {
			disposed = true;
			scanner.current?.destroy();
			scanner.current = null;
		};
	}, []);

	useEffect(() => {
		if (!scanner.current || status !== "scanning") return;
		if (paused) scanner.current.stop();
		else void scanner.current.start();
	}, [paused, status]);

	return (
		<div className="scan-frame" data-status={status}>
			<video ref={video} muted playsInline />
			<span className="scan-reticle" aria-hidden />
			{status !== "scanning" ? (
				<p className="scan-message">
					{status === "starting" ? "開啟相機中…" : status === "denied" ? "沒有相機權限。請在瀏覽器允許相機，或在下方輸入車號。" : "這個裝置沒有可用的相機，請在下方輸入車號。"}
				</p>
			) : null}
		</div>
	);
}
