import { useEffect, useState } from "react";
import { Gift, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { Badge, Button, EmptyState, Field } from "../components/ui";
import { formatDate } from "../utils/format";

export default function LotteryPage() {
  const { token } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [form, setForm] = useState({
    playerName: "",
    playerUid: "",
    contact: "",
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    try {
      setCampaign(await api(`/api/public/lotteries/${token}`));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [token]);
  const join = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api(`/api/public/lotteries/${token}/entries`, {
        method: "POST",
        body: {
          ...form,
          playerUid: form.playerUid || undefined,
          contact: form.contact || undefined,
        },
      });
      setMessage("参与成功，请保存此页面并等待开奖。");
      setError("");
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };
  if (loading)
    return (
      <div className="boot-screen">
        <Sparkles />
        <span>正在读取活动…</span>
      </div>
    );
  if (!campaign)
    return (
      <div className="lottery-page">
        <EmptyState
          icon={Gift}
          title="无法打开活动"
          description={error || "活动不存在"}
          action={
            <Link className="btn btn-secondary btn-md" to="/">
              返回首页
            </Link>
          }
        />
      </div>
    );
  return (
    <div className="lottery-page">
      <header className="lottery-brand">
        <img src="/assets/fengqi-mark.svg" alt="" />
        <span>
          <strong>风起游戏</strong>
          <small>GROUP LOTTERY</small>
        </span>
      </header>
      <main className="lottery-card">
        <div className="lottery-hero">
          <span className="eyebrow">{campaign.mapName}</span>
          <Sparkles size={36} />
          <h1>{campaign.title}</h1>
          <p>{campaign.description || "参与活动，等待管理员开奖。"}</p>
          <div>
            <Badge tone={campaign.status === "open" ? "positive" : "neutral"}>
              {campaign.status === "open"
                ? "报名中"
                : campaign.status === "drawn"
                  ? "已开奖"
                  : "已结束"}
            </Badge>
            <span>{campaign.participantCount} 人参与</span>
            <span>{campaign.winnerCount} 个名额</span>
          </div>
        </div>
        {campaign.status === "open" ? (
          <form className="lottery-form" onSubmit={join}>
            <Field label="游戏名">
              <input
                className="input"
                value={form.playerName}
                onChange={(event) =>
                  setForm({ ...form, playerName: event.target.value })
                }
                required
              />
            </Field>
            <Field label="玩家 UID（建议填写）">
              <input
                className="input"
                value={form.playerUid}
                onChange={(event) =>
                  setForm({ ...form, playerUid: event.target.value })
                }
              />
            </Field>
            <Field label="联系方式（选填）">
              <input
                className="input"
                value={form.contact}
                onChange={(event) =>
                  setForm({ ...form, contact: event.target.value })
                }
              />
            </Field>
            {campaign.drawAt && (
              <p className="warning-note">
                报名截止：{formatDate(campaign.drawAt)}
              </p>
            )}
            {error && <p className="form-error">{error}</p>}
            {message && <p className="form-success">{message}</p>}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              icon={Gift}
              disabled={submitting || Boolean(message)}
            >
              {submitting ? "正在提交…" : message ? "已参与" : "确认参与"}
            </Button>
          </form>
        ) : campaign.status === "drawn" ? (
          <section className="lottery-winners">
            <Trophy size={32} />
            <h2>开奖结果</h2>
            {campaign.winners.length ? (
              campaign.winners.map((winner) => (
                <div key={`${winner.player_uid}-${winner.player_name}`}>
                  <strong>{winner.player_name}</strong>
                  <code>{winner.player_uid || "未填写 UID"}</code>
                </div>
              ))
            ) : (
              <p>没有产生中奖者。</p>
            )}
          </section>
        ) : (
          <EmptyState title="活动已经结束" />
        )}
        <footer>
          <ShieldCheck size={15} />
          湖北风起文化有限公司 · 每个游戏名或 UID 只能参与一次
        </footer>
      </main>
    </div>
  );
}
