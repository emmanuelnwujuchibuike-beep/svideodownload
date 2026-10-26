import { Notice, SubHeader, WalletScreen } from "./wallet-ui";

/** The server couldn't read the wallet: said plainly, nothing shown that could be mistaken for a balance. */
export function WalletLoadError({ title }: { title: string }) {
  return (
    <WalletScreen label={title}>
      <SubHeader title={title} />
      <Notice tone="error" title="Couldn't load your wallet" className="mt-6">
        Nothing has changed. Pull down to try again in a moment.
      </Notice>
    </WalletScreen>
  );
}
