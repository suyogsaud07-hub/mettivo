'use client';

/**
 * Offline fallback, precached by the service worker as `/offline`.
 *
 * This page is intentionally dependency-free (no Supabase, no language
 * context, inline styles only) so that it still renders correctly when the
 * network is unavailable and no other assets have been cached.
 */
export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0D0A10',
        color: '#F2E9E4',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        padding: '32px',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/*
        The mark is INLINED, not imported, on purpose: this page is precached
        by the service worker and must render with no network and no extra
        chunk fetch. The artwork is the same as `src/components/Logo.tsx` —
        if the brand changes, both move together.
      */}
      <svg viewBox="240 0 520 870" width="64" height="107" aria-hidden="true" style={{ opacity: 0.9 }}>

        <defs>
          {/*
        Warm sandy-gold gradient for the figures. The two directions let the
        "M" turn from light into shade, so the strokes read as solid forms
        rather than a flat outline.
      */}
          <linearGradient id="mvGoldLight" x1="0" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#f0d8b6" />
            <stop offset="0.5" stopColor="#e0bc93" />
            <stop offset="1" stopColor="#cfab83" />
          </linearGradient>
          <linearGradient id="mvGoldMid" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e0bc93" />
            <stop offset="1" stopColor="#d8b38a" />
          </linearGradient>
          <linearGradient id="mvGoldDeep" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#cfa87e" />
            <stop offset="1" stopColor="#b58c5e" />
          </linearGradient>
          <linearGradient id="mvHeadLeft" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#f0d8b6" />
            <stop offset="1" stopColor="#d8b38a" />
          </linearGradient>
          <linearGradient id="mvHeadRight" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#e8cba6" />
            <stop offset="1" stopColor="#cfab83" />
          </linearGradient>

          {/* Soft muted rose for the heart accent. */}
          <linearGradient id="mvHeart" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor="#d4a3a5" />
            <stop offset="1" stopColor="#c78c8d" />
          </linearGradient>

          {/* Deep burgundy-plum for the rose. */}
          <linearGradient id="mvRose" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#8d4a5f" />
            <stop offset="0.6" stopColor="#5d2b3c" />
            <stop offset="1" stopColor="#4a1c2e" />
          </linearGradient>

          {/*
        Depth, applied to the NEAR pair only.
        `feDropShadow` is used deliberately instead of a hand-built
        feGaussianBlur/feOffset/feComposite chain: an earlier version of this file
        ended the chain with feComponentTransfer, which replaced the stroke's own
        colour with a black silhouette and rendered the whole mark black. A drop
        shadow composites over the source instead of replacing it, so the gradient
        survives and only the overlap edge is shaded.
      */}
          <filter id="mvLift" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="7" dy="9" stdDeviation="7" floodColor="#1b0f14" floodOpacity="0.32" />
          </filter>
        </defs>

        {/*
        ============================================================
        The figures. Two tapered strokes whose combined silhouette forms
        the letter "M": the near arms cross at the centre, and the two
        bodies fall into its outer legs. Every stroke is one continuous
        path, so the mark stays abstract rather than cartoonish.
        ============================================================
      */}

        {/*
        Far pair: drawn first, in the deeper tone, so the near pair reads
        as being in front of it.
      */}
        <path
          d="M 386 258 Q 418 372 500 392 Q 582 372 614 258"
          fill="none" stroke="url(#mvGoldDeep)" strokeWidth="50" strokeLinecap="round"
        />
        <path
          d="M 392 292 C 378 404 348 574 300 700 C 276 750 270 796 300 808"
          fill="none" stroke="url(#mvGoldDeep)" strokeWidth="66" strokeLinecap="round"
        />
        <path
          d="M 608 292 C 622 404 652 574 700 700 C 724 750 730 796 700 808"
          fill="none" stroke="url(#mvGoldDeep)" strokeWidth="66" strokeLinecap="round"
        />

        {/*
        Near pair: the arms cross to form the "M" valley, and the heads lean
        together above the heart.
      */}
        <g filter="url(#mvLift)">
          <path
            d="M 404 258 Q 452 396 552 346 Q 602 318 626 248"
            fill="none" stroke="url(#mvGoldMid)" strokeWidth="46" strokeLinecap="round"
          />
          <path
            d="M 596 258 Q 548 396 448 346 Q 398 318 374 248"
            fill="none" stroke="url(#mvGoldMid)" strokeWidth="46" strokeLinecap="round"
          />
          <path
            d="M 412 292 C 394 400 356 560 306 694 C 282 744 284 790 318 806"
            fill="none" stroke="url(#mvGoldLight)" strokeWidth="80" strokeLinecap="round"
          />
          <path
            d="M 588 292 C 606 400 644 560 694 694 C 718 744 716 790 682 806"
            fill="none" stroke="url(#mvGoldLight)" strokeWidth="80" strokeLinecap="round"
          />
        </g>

        {/*
        Heads. The right sits marginally lower and smaller, as in the
        reference, where the two figures are not perfectly mirrored.
      */}
        <circle cx="408" cy="98" r="72" fill="url(#mvHeadLeft)" />
        <circle cx="562" cy="116" r="64" fill="url(#mvHeadRight)" />

        {/* Heart, resting in the valley where the two figures meet. */}
        <path
          d="M 500 200 C 500 180 476 174 469 189 C 460 206 476 220 500 238 C 524 220 540 206 531 189 C 524 174 500 180 500 200 Z"
          fill="url(#mvHeart)"
        />

        {/* Rose: slender stem through the centre, two leaves, layered petals. */}
        <g>
          <path d="M 506 508 C 514 572 520 636 524 700" fill="none" stroke="#6b4a3a" strokeWidth="7" strokeLinecap="round" />
          <path d="M 512 598 C 534 584 554 590 560 606 C 546 620 526 616 512 598 Z" fill="#5f3346" />
          <path d="M 517 650 C 495 638 477 646 473 662 C 487 674 506 668 517 650 Z" fill="#4a1c2e" />

          <circle cx="509" cy="478" r="28" fill="url(#mvRose)" />
          <path d="M 493 458 C 517 443 543 458 536 480 C 530 496 510 500 499 489 C 492 481 494 469 505 464" fill="none" stroke="#8d4a5f" strokeWidth="8" strokeLinecap="round" />
          <path d="M 499 474 C 510 469 521 475 519 486 C 517 495 506 499 501 493" fill="none" stroke="#a35d72" strokeWidth="6" strokeLinecap="round" />
        </g>
      </svg>

      <h1
        style={{
          fontSize: '22px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          margin: 0,
        }}
      >
        You&apos;re offline
      </h1>

      <p
        style={{
          fontSize: '14px',
          color: '#B58A83',
          maxWidth: '300px',
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        Mettivo needs a connection to load new content. Check your network and
        try again.
      </p>

      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: '8px',
          backgroundColor: '#D4B18A',
          color: '#17121C',
          padding: '14px 32px',
          borderRadius: '30px',
          fontSize: '15px',
          fontWeight: 700,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  );
}
