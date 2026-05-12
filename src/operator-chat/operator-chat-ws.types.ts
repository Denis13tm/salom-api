import { ChatMessageSender } from '@prisma/client';

/** Operator va administrator kanallari — mobil/web WS payload. */
export type ChatChannel = 'operator' | 'admin';

/** Socket `chat:message` (driver namespace + operator `chat:ops` + admin `chat:admins`) — v1. */
export type ChatMessagePayloadV1 = {
  v: 1;
  channel: ChatChannel;
  driverId: string;
  threadId: string;
  message: {
    id: string;
    sender: ChatMessageSender;
    body: string;
    createdAt: string;
    operatorDisplayName: string | null;
    adminDisplayName: string | null;
  };
};
