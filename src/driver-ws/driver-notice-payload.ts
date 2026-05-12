export type DriverNoticeCategory =
  | "account_suspended"
  | "account_restored"
  | "application_approved"
  | "application_rejected"
  | "application_under_review"
  /** Administrator yangilik / e’lon (push + socket). */
  | "admin_news";

/** Socket `/driver`, event `driver:notice` — v1. Mobil ilova bir martalik ogohlantirish. */
export type DriverNoticeWsPayloadV1 = {
  v: 1;
  id: string;
  category: DriverNoticeCategory;
  title: string;
  body: string;
  occurredAt: string;
};
