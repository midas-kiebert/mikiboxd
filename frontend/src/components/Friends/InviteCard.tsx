/**
 * Your invite link — the app's "Scan To Add Me" card, on the web.
 *
 * The app's QR code, for someone standing next to you with their phone, plus
 * the link itself, since on a computer that is usually what you pass on (a
 * chat, an email): shown, copied, and on a browser that can share (a phone)
 * handed to the system share sheet, as the app's button does. Opening the link sends
 * you a friend request from whoever opened it (`/add-friend/$receiverId`).
 */
import { useQuery } from "@tanstack/react-query"
import QRCode from "qrcode"
import { useEffect, useState } from "react"
import { MdCheck, MdContentCopy, MdIosShare } from "react-icons/md"
import { MeService } from "shared/client"

import { FriendButton } from "@/components/Friends/friend-controls"
import useCustomToast from "@/hooks/useCustomToast"

/** The app's QR plate size (`QR_SIZE` in the Friends tab). */
const QR_SIZE = 180

/** How long "Copied" stays on the button before it says "Copy link" again. */
const COPIED_RESET_MS = 2000

const buildInviteUrl = (userId: string) =>
  `${window.location.origin}/add-friend/${encodeURIComponent(userId)}`

const InviteCard = () => {
  const { showErrorToast } = useCustomToast()
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: MeService.getCurrentUser,
  })
  const [copied, setCopied] = useState(false)
  const inviteUrl = currentUser ? buildInviteUrl(currentUser.id) : null
  const username = currentUser?.display_name?.trim() || null
  const qrSrc = useQrCode(inviteUrl)
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function"

  const handleCopy = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPIED_RESET_MS)
    } catch {
      showErrorToast("Could not copy the link. Select it and copy it by hand.")
    }
  }

  const handleShare = () => {
    if (!inviteUrl) return
    // Dismissing the share sheet rejects; that is not an error worth a toast.
    navigator
      .share({ title: "Add me on MiKiNO", url: inviteUrl })
      .catch(() => {})
  }

  return (
    <section className="fr-invite" aria-label="Your invite link">
      <p className="fr-invite__title">Invite a friend</p>
      {username ? <p className="fr-invite__username">{username}</p> : null}
      {/* A QR code needs its white quiet zone to scan, in either colour scheme. */}
      <div
        className="fr-invite__qr"
        style={{ width: QR_SIZE + 24, height: QR_SIZE + 24 }}
      >
        {qrSrc ? (
          <img
            src={qrSrc}
            width={QR_SIZE}
            height={QR_SIZE}
            alt="QR code for your invite link"
          />
        ) : null}
      </div>
      <p className="fr-invite__text">
        Let a friend scan this, or send them your link. Opening it sends you a
        friend request.
      </p>
      <input
        className="fr-invite__link"
        readOnly
        value={inviteUrl ?? ""}
        aria-label="Your invite link"
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="fr-invite__actions">
        <FriendButton
          primary
          icon={copied ? <MdCheck size={15} /> : <MdContentCopy size={15} />}
          onClick={handleCopy}
          busy={!inviteUrl}
        >
          {copied ? "Copied" : "Copy link"}
        </FriendButton>
        {canShare ? (
          <FriendButton
            icon={<MdIosShare size={15} />}
            onClick={handleShare}
            busy={!inviteUrl}
          >
            Share
          </FriendButton>
        ) : null}
      </div>
    </section>
  )
}

/** The invite link drawn as a QR image, once there is a link to draw. */
const useQrCode = (value: string | null) => {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!value) return
    let cancelled = false
    QRCode.toDataURL(value, {
      width: QR_SIZE * 2, // Drawn at 2x, so it stays crisp on a dense screen.
      margin: 0,
      color: { dark: "#111111", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [value])
  return src
}

export default InviteCard
