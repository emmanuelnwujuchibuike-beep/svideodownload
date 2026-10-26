"use client";

import { ActivityList } from "./activity";
import type { HistoryPage } from "./api";
import { useRefreshOnLongReturn } from "./use-wallet-runtime";
import { Notice, SubHeader, Unavailable, WalletScreen } from "./wallet-ui";

/** /wallet/activity (design: Main → See all): the whole history, paged on tap. */
export function WalletActivity({ history, disabled, loadedAt }: { history: HistoryPage | null; disabled?: boolean; loadedAt: number }) {
  useRefreshOnLongReturn();
  return (
    <WalletScreen label="Activity">
      <SubHeader title="Activity" />
      {disabled ? (
        <Unavailable title="Frenz Coin isn't available yet">There&apos;s no activity to show while the wallet is switched off.</Unavailable>
      ) : history ? (
        <div className="mt-3">
          <ActivityList initial={history.items} initialNext={history.next} loadedAt={loadedAt} paged />
        </div>
      ) : (
        <Notice tone="error" className="mt-6">
          Couldn&apos;t load your activity. Pull down to try again.
        </Notice>
      )}
    </WalletScreen>
  );
}
