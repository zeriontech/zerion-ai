// Per-circuit ZK provers. We instantiate each prover lazily and reuse it.
// Default asset provider is the Umbra public CDN — see advanced.md §5
// for self-hosted options + Web Worker (comlink) integration.
//
// Performance: 2–8s in browser (WebAssembly), 1–3s in Node. The current
// scaffold runs the prover on the main thread for simplicity; for
// production, wrap in a Web Worker via comlink (advanced.md §5).

import {
  getCdnZkAssetProvider,
  getCreateReceiverClaimableUtxoFromPublicBalanceProver,
  getCreateReceiverClaimableUtxoFromEncryptedBalanceProver,
  getCreateSelfClaimableUtxoFromPublicBalanceProver,
  getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getClaimSelfClaimableUtxoIntoPublicBalanceProver,
  getUserRegistrationProver,
} from "@umbra-privacy/web-zk-prover";

const assetProvider = getCdnZkAssetProvider();

const deps = { assetProvider };

export const createReceiverFromPublicProver = getCreateReceiverClaimableUtxoFromPublicBalanceProver(deps);
export const createReceiverFromEncryptedProver = getCreateReceiverClaimableUtxoFromEncryptedBalanceProver(deps);
export const createSelfFromPublicProver = getCreateSelfClaimableUtxoFromPublicBalanceProver(deps);
export const claimReceiverIntoEncryptedProver = getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(deps);
export const claimSelfIntoPublicProver = getClaimSelfClaimableUtxoIntoPublicBalanceProver(deps);
export const registrationProver = getUserRegistrationProver(deps);
