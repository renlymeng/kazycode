import { Injectable } from '@nestjs/common';
import axios from 'axios';

interface LookupParams {
  playerId: string;
  playerServer?: string;
}

type Adapter = (params: LookupParams) => Promise<string | null>;

/**
 * Registry of publisher-specific nickname-lookup adapters. Each game row
 * stores an `nicknameApiAdapter` key (e.g. "mobile_legends", "free_fire")
 * that maps to one of these functions. Adding a new game/publisher only
 * requires registering a new adapter here — no changes to order flow.
 *
 * All adapters share: a short timeout, no retry inside the request path
 * (the caller decides), and normalized "not found" -> null (never throws
 * for a simply-invalid ID; throws only on genuine network/API failure).
 */
@Injectable()
export class NicknameValidationService {
  private adapters: Record<string, Adapter> = {
    mobile_legends: async ({ playerId, playerServer }) => {
      const { data } = await axios.get(process.env.ML_NICKNAME_API_URL!, {
        params: { userid: playerId, zoneid: playerServer, key: process.env.ML_NICKNAME_API_KEY },
        timeout: 6000,
      });
      return data?.username ?? null;
    },

    free_fire: async ({ playerId }) => {
      const { data } = await axios.get(process.env.FF_NICKNAME_API_URL!, {
        params: { uid: playerId, key: process.env.FF_NICKNAME_API_KEY },
        timeout: 6000,
      });
      return data?.nickname ?? null;
    },

    pubg_mobile: async ({ playerId }) => {
      const { data } = await axios.get(process.env.PUBGM_NICKNAME_API_URL!, {
        params: { id: playerId, key: process.env.PUBGM_NICKNAME_API_KEY },
        timeout: 6000,
      });
      return data?.character_name ?? null;
    },
  };

  registerAdapter(key: string, fn: Adapter) {
    this.adapters[key] = fn;
  }

  async lookup(adapterKey: string, params: LookupParams): Promise<string | null> {
    const adapter = this.adapters[adapterKey];
    if (!adapter) throw new Error(`No nickname adapter registered for "${adapterKey}"`);
    return adapter(params);
  }
}
