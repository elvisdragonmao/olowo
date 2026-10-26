import { ArrowLeft, Camera, CheckCircle, CreditCard } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "../../app/useUiStore";
import { apiRequest, idempotencyKey } from "../../shared/api";
import { timeOfDay } from "../../shared/format";
import { stationLabel } from "../fleet/model";
import { useUnpaidRide, type UnpaidRide } from "./useUnpaidRide";

type Bill = {
	cost: number;
	minimumPrice: number;
	ridingMinutes: number;
	parkedMinutes: number;
	ratePerMinute: number | null;
	planName: string | null;
	endedAt: string | null;
	returnStation: string | null;
};
type Card = { id: number; issuer: string | null; lastFour: string | null; valid: boolean };
type Paid = { amount: number | null; pointsDeducted: number | null; label: string };

export function CheckoutView() {
	const back = useUiStore(state => state.back);
	// Right after a return oloo may take a moment to list the ride as unpaid, so poll until it shows up.
	const ride = useUnpaidRide({ poll: true });
	const [paid, setPaid] = useState<Paid | null>(null);

	return (
		<>
			<header className="view-head" data-sheet-drag>
				<button type="button" className="icon-button" aria-label="返回" onClick={back}>
					<ArrowLeft size={18} weight="bold" />
				</button>
				<div className="view-head-title">
					<h2>{paid ? "已完成付款" : "還車結帳"}</h2>
					{ride.data ? <p className="plate-inline">{ride.data.label}</p> : null}
				</div>
			</header>
			<div className="view-body">
				{paid ? (
					<PaidSummary paid={paid} />
				) : ride.data ? (
					<Checkout ride={ride.data} onPaid={setPaid} />
				) : (
					<div className="empty-state">
						<p>{ride.isPending ? "讀取騎乘紀錄…" : "沒有待結帳的騎乘。"}</p>
					</div>
				)}
			</div>
		</>
	);
}

function PaidSummary({ paid }: { paid: Paid }) {
	const navigate = useUiStore(state => state.navigate);
	return (
		<>
			<section className="ride-hero">
				<CheckCircle size={36} weight="fill" className="paid-mark" aria-hidden />
				<span className="hero-number">
					<small>$</small>
					{paid.amount ?? "—"}
				</span>
				<span className="hero-caption">
					{paid.label} 已付款{paid.pointsDeducted ? ` · 折抵 ${paid.pointsDeducted} 點` : ""}
				</span>
			</section>
			<button type="button" className="button button-primary button-block" onClick={() => navigate({ kind: "nearby" }, { replace: true })}>
				回到地圖
			</button>
		</>
	);
}

/** Shrinks a camera photo to at most 1600 px on the long edge before upload; oloo only needs proof of parking. */
async function compressPhoto(file: File) {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("無法處理照片"))), "image/jpeg", 0.82));
}

function Checkout({ ride, onPaid }: { ride: UnpaidRide; onPaid: (paid: Paid) => void }) {
	const queryClient = useQueryClient();
	const [preview, setPreview] = useState<string | null>(null);
	const [imageId, setImageId] = useState<number | null>(null);
	const [cardId, setCardId] = useState<number | null>(null);
	const [useOlooCoin, setUseOlooCoin] = useState(true);

	// Priced by the API at the moment of return, so this does not grow while the rider takes a photo.
	const bill = useQuery({
		queryKey: ["ride", ride.id, "bill"],
		queryFn: () => apiRequest<{ bill: Bill }>(`/v1/rides/${ride.id}/bill`),
		select: data => data.bill,
		retry: false
	});
	const cards = useQuery({ queryKey: ["payment", "cards"], queryFn: () => apiRequest<{ cards: Card[] }>("/v1/payment/cards"), select: data => data.cards.filter(card => card.valid) });
	useEffect(() => {
		if (cardId == null && cards.data?.[0]) setCardId(cards.data[0].id);
	}, [cardId, cards.data]);
	useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

	// Only the most recent upload counts, so a slow placeholder cannot replace a photo the rider took after it.
	const latestUpload = useRef(0);
	const upload = useMutation({
		mutationFn: async ({ file }: { file: File | "placeholder"; seq: number }) => {
			if (file === "placeholder") return apiRequest<{ imageId: number }>(`/v1/rides/${ride.id}/photo?placeholder=1`, { method: "POST" });
			const photo = await compressPhoto(file);
			return apiRequest<{ imageId: number }>(`/v1/rides/${ride.id}/photo`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: photo });
		},
		onSuccess: (data, { seq }) => seq === latestUpload.current && setImageId(data.imageId)
	});
	const { mutate: sendUpload } = upload;
	const sendPhoto = useCallback((file: File | "placeholder") => sendUpload({ file, seq: ++latestUpload.current }), [sendUpload]);
	// The photo is optional: start with the blank placeholder so the rider can pay at once.
	useEffect(() => {
		if (latestUpload.current === 0) sendPhoto("placeholder");
	}, [sendPhoto]);
	const pay = useMutation({
		mutationFn: () =>
			apiRequest<{ amount: number | null; pointsDeducted: number | null }>(`/v1/rides/${ride.id}/checkout`, {
				method: "POST",
				headers: { "idempotency-key": idempotencyKey() },
				body: JSON.stringify({ imageId, cardId, useOlooCoin })
			}),
		onSuccess: async data => {
			onPaid({ ...data, label: ride.label });
			await Promise.all(["ride", "fleet"].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
		}
	});

	return (
		<>
			<section className="bill-card" aria-label="帳單">
				{bill.data ? (
					<>
						<p className="bill-total">
							<small>$</small>
							{bill.data.cost}
						</p>
						<dl className="bill-lines">
							<div>
								<dt>騎乘</dt>
								<dd>{bill.data.ridingMinutes} 分</dd>
							</div>
							<div>
								<dt>臨停</dt>
								<dd>{bill.data.parkedMinutes} 分</dd>
							</div>
							{bill.data.ratePerMinute != null ? (
								<div>
									<dt>費率</dt>
									<dd>${bill.data.ratePerMinute}/分</dd>
								</div>
							) : null}
							<div>
								<dt>方案</dt>
								<dd>{bill.data.planName ?? "一般"}</dd>
							</div>
						</dl>
					</>
				) : (
					<p className={bill.isPending ? "skeleton-text" : "inline-error"}>{bill.isPending ? "計算帳單" : `無法取得帳單：${bill.error?.message ?? ""}`}</p>
				)}
				<p className="muted small">
					{timeOfDay(ride.startedAt)} – {timeOfDay(bill.data?.endedAt ?? ride.endedAt)} 停止計費
					{bill.data?.returnStation ? ` · 還在${stationLabel(bill.data.returnStation).name}` : ""}
				</p>
			</section>

			<section className="section">
				<h3 className="section-title">
					<Camera size={16} weight="bold" aria-hidden /> 還車照片（可選）
				</h3>
				<p className="muted small">已自動附上一張空白照片，可以直接付款。想留存證明的話，拍下車身與站點格位。</p>
				<label className="photo-picker" data-done={imageId != null}>
					{preview ? <img src={preview} alt="還車照片預覽" /> : <Camera size={28} weight="duotone" aria-hidden />}
					<span>{upload.isPending ? "上傳中…" : imageId != null ? (preview ? "已上傳，點此重拍" : "已附上空白照片，點此改拍") : "拍攝還車照片"}</span>
					<input
						type="file"
						accept="image/*"
						capture="environment"
						aria-label="拍攝還車照片"
						onChange={event => {
							const file = event.target.files?.[0];
							if (!file) return;
							setImageId(null);
							setPreview(URL.createObjectURL(file));
							sendPhoto(file);
						}}
					/>
				</label>
				{preview || (upload.isError && imageId == null) ? (
					<button
						type="button"
						className="button button-quiet button-block"
						disabled={upload.isPending}
						onClick={() => {
							setPreview(null);
							setImageId(null);
							sendPhoto("placeholder");
						}}
					>
						改用空白照片
					</button>
				) : null}
				{upload.error ? <p className="inline-error">照片上傳失敗：{upload.error.message}</p> : null}
			</section>

			<section className="section">
				<h3 className="section-title">
					<CreditCard size={16} weight="bold" aria-hidden /> 付款
				</h3>
				{cards.data && cards.data.length > 0 ? (
					<div className="segmented" role="radiogroup" aria-label="信用卡">
						{cards.data.map(card => (
							<button key={card.id} type="button" role="radio" aria-checked={cardId === card.id} onClick={() => setCardId(card.id)}>
								{card.issuer ?? "信用卡"} •••• {card.lastFour ?? "----"}
							</button>
						))}
					</div>
				) : (
					<p className="muted small">{cards.isPending ? "讀取信用卡…" : "這個帳號沒有可用的信用卡，請先在 oloo App 綁定。"}</p>
				)}
				<label className="toggle-row">
					<input type="checkbox" checked={useOlooCoin} onChange={event => setUseOlooCoin(event.target.checked)} />
					<span>優先使用 oloo 點數折抵</span>
				</label>
				<button type="button" className="button button-primary button-block" disabled={imageId == null || cardId == null || pay.isPending || !bill.data} onClick={() => pay.mutate()}>
					{pay.isPending ? "付款中…" : bill.data ? `付款 $${bill.data.cost}` : "付款"}
				</button>
				{pay.error ? <p className="inline-error">付款失敗：{pay.error.message}。帳單仍未結清，可以再試一次。</p> : null}
			</section>
		</>
	);
}
