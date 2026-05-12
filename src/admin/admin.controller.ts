import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { Express, Request, Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { DriverOnboardingStatus, UserAccountStatus } from "@prisma/client";
import { OnboardingService } from "../driver-onboarding/onboarding.service";
import { UploadDriverDocBodyDto } from "../driver-onboarding/dto/upload-driver-doc-body.dto";
import { SalomAdminGuard } from "./salom-admin.guard";
import { AdminService } from "./admin.service";
import { ConfirmSettlementDto } from "./dto/confirm-settlement.dto";
import { CreateDriverAdminDto } from "./dto/create-driver-admin.dto";
import { CreateOperatorDto } from "./dto/create-operator.dto";
import { PatchSmsTemplateDto } from "./dto/patch-sms-template.dto";
import { RecordLedgerAdjustmentDto } from "./dto/record-ledger-adjustment.dto";
import { RecordPayoutDto } from "./dto/record-payout.dto";
import { RecordTopUpDto } from "./dto/record-top-up.dto";
import { TestSmsDto } from "./dto/test-sms.dto";
import { UpdateDriverPayoutAdminDto } from "./dto/update-driver-payout-admin.dto";
import { UpdateOperatorDto } from "./dto/update-operator.dto";
import { RejectDriverDto } from "./dto/reject-driver.dto";
import { CreateServiceZoneDto } from "./dto/create-service-zone.dto";
import { UpdateZoneMeterDto } from "./dto/update-zone-meter.dto";
import {
  AdminCreateVehicleDto,
  AdminPatchVehicleDto,
} from "./dto/admin-driver-vehicle.dto";
import { PatchPlatformChampionsDto } from "./dto/patch-platform-champions.dto";
import { PatchPlatformPricingDto } from "./dto/patch-platform-pricing.dto";
import { GamificationService } from "../gamification/gamification.service";
import { SendDriverBroadcastDto } from "./dto/send-driver-broadcast.dto";
import { UpdateAdminDriverNewsDto } from "./dto/update-admin-driver-news.dto";
import { PatchZonePickupPricingDto } from "./dto/patch-zone-pickup-pricing.dto";
import { CreatePickupPricingRingDto } from "./dto/create-pricing-ring.dto";
import { UpdatePickupPricingRingDto } from "./dto/update-pricing-ring.dto";
import { PatchDriverXpSettingsDto } from "./dto/patch-driver-xp-settings.dto";
import { UpsertDriverXpOverrideDto } from "./dto/upsert-driver-xp-override.dto";

@Controller({ path: "admin", version: "1" })
@UseGuards(SalomAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly onboarding: OnboardingService,
    private readonly gamification: GamificationService,
  ) {}

  @Get("dashboard")
  async dashboard() {
    return this.admin.dashboard();
  }

  @Get("config/pricing")
  async pricing() {
    return this.admin.platformPricing();
  }

  @Patch("config/pricing")
  @HttpCode(200)
  patchPricing(@Body() body: PatchPlatformPricingDto, @Req() req: Request) {
    return this.admin.patchPlatformPricing(body, req.salomAdminUserId);
  }

  @Get("config/champions")
  championsConfig() {
    return this.admin.platformChampionsConfig();
  }

  @Patch("config/champions")
  @HttpCode(200)
  patchChampions(@Body() body: PatchPlatformChampionsDto, @Req() req: Request) {
    return this.admin.patchPlatformChampions(body, req.salomAdminUserId);
  }

  @Post("config/champions/banners/upload")
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 4 * 1024 * 1024 },
    }),
  )
  uploadChampionsBanner(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.admin.uploadChampionsHomeBannerFile(file, req.salomAdminUserId);
  }

  @Delete("config/champions/banners/:filename")
  @HttpCode(200)
  deleteChampionsBanner(
    @Param("filename") filename: string,
    @Req() req: Request,
  ) {
    return this.admin.deleteChampionsHomeBannerFile(filename, req.salomAdminUserId);
  }

  @Get("gamification/leaderboard")
  async adminLeaderboard(
    @Query("zoneId") zoneId: string,
    @Query("period") period?: string,
    @Query("page") pageStr?: string,
    @Query("limit") limitStr?: string,
    @Query("search") search?: string,
  ) {
    const z = zoneId?.trim();
    if (!z) {
      throw new BadRequestException("zoneId is required");
    }
    const p = period === "week" ? "week" : "month";
    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    try {
      return await this.gamification.getAdminZoneLeaderboardPage(
        z,
        p,
        Number.isFinite(page) ? page : 1,
        Number.isFinite(limit) ? limit : 20,
        search,
      );
    } catch (e) {
      // Admin-only diagnostics: expose underlying SQL/Prisma error to unblock fixes.
      const msg = (e as { message?: unknown })?.message;
      throw new BadRequestException(
        typeof msg === "string" && msg.trim()
          ? msg
          : "Leaderboard query failed",
      );
    }
  }

  /** Admin: oylik leaderboard ball/trips override (ball edit qilinsa trips ham derivatsiya qilinadi). */
  @Post("gamification/leaderboard/override/:driverId")
  @HttpCode(200)
  upsertMonthlyLeaderboardOverride(
    @Param("driverId") driverId: string,
    @Body() body: { periodYm?: string; score: number },
    @Req() req: Request,
  ) {
    const did = driverId?.trim();
    if (!did) {
      throw new BadRequestException("driverId is required");
    }
    const score = Math.max(0, Math.trunc(body?.score ?? 0));
    // Har safar +100 ball — score’dan trips derivatsiya qilamiz.
    const trips = Math.max(0, Math.ceil(score / 100));
    const now = new Date();
    const ymRaw =
      body?.periodYm?.trim() ||
      `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const periodYm = ymRaw.slice(0, 7);
    return this.admin.upsertMonthlyLeaderboardOverride(req.salomAdminUserId, {
      driverId: did,
      periodYm,
      score,
      trips,
    });
  }

  /** Admin test: oylik leaderboard davrini keyingi oyga surish (oy yakunini simulyatsiya). */
  @Post("gamification/champions/end-month")
  @HttpCode(200)
  endChampionsMonth(@Req() req: Request) {
    return this.admin.advanceChampionsMonthOverride(req.salomAdminUserId);
  }

  /** Admin test: champions oy override'ni o‘chirish (real kalendar oyga qaytish). */
  @Post("gamification/champions/reset-month")
  @HttpCode(200)
  resetChampionsMonth(@Req() req: Request) {
    return this.admin.clearChampionsMonthOverride(req.salomAdminUserId);
  }

  @Get("gamification/xp-settings")
  driverXpSettings() {
    return this.admin.getDriverXpGamificationSettings();
  }

  @Patch("gamification/xp-settings")
  @HttpCode(200)
  patchDriverXpSettings(
    @Body() body: PatchDriverXpSettingsDto,
    @Req() req: Request,
  ) {
    return this.admin.patchDriverXpGamificationSettings(
      req.salomAdminUserId,
      body,
    );
  }

  @Get("gamification/xp-leaderboard")
  async driverXpLeaderboard(
    @Query("zoneId") zoneId: string,
    @Query("page") pageStr?: string,
    @Query("limit") limitStr?: string,
    @Query("search") search?: string,
  ) {
    const z = zoneId?.trim();
    if (!z) {
      throw new BadRequestException("zoneId is required");
    }
    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    try {
      return await this.gamification.getAdminZoneXpLeaderboardPage(
        z,
        Number.isFinite(page) ? page : 1,
        Number.isFinite(limit) ? limit : 20,
        search,
      );
    } catch (e) {
      const msg = (e as { message?: unknown })?.message;
      throw new BadRequestException(
        typeof msg === "string" && msg.trim()
          ? msg
          : "XP leaderboard query failed",
      );
    }
  }

  @Post("gamification/xp-override/:driverId")
  @HttpCode(200)
  upsertDriverXpOverride(
    @Param("driverId") driverId: string,
    @Body() body: UpsertDriverXpOverrideDto,
    @Req() req: Request,
  ) {
    return this.admin.upsertDriverLifetimeXpOverrideAdmin(
      req.salomAdminUserId,
      driverId,
      body.xp,
    );
  }

  @Delete("gamification/xp-override/:driverId")
  @HttpCode(200)
  deleteDriverXpOverride(
    @Param("driverId") driverId: string,
    @Req() req: Request,
  ) {
    return this.admin.deleteDriverLifetimeXpOverrideAdmin(
      req.salomAdminUserId,
      driverId,
    );
  }

  @Get("config/security")
  security() {
    return this.admin.securityInfo();
  }

  @Get("finance/commission-monthly")
  commissionMonthly(@Query("periodYm") periodYm: string) {
    return this.admin.commissionMonthlyByPeriod(periodYm);
  }

  @Post("finance/settlements/sync")
  @HttpCode(200)
  syncSettlements(@Body() body: { periodYm: string }, @Req() req: Request) {
    return this.admin.persistMonthlySettlements(
      body.periodYm,
      req.salomAdminUserId,
    );
  }

  @Get("finance/settlements")
  listSettlements(@Query("periodYm") periodYm: string) {
    return this.admin.listDriverMonthSettlements(periodYm);
  }

  @Post("finance/settlements/:id/confirm")
  @HttpCode(200)
  confirmSettlement(
    @Param("id") id: string,
    @Body() body: ConfirmSettlementDto,
    @Req() req: Request,
  ) {
    return this.admin.confirmDriverMonthSettlement(id, req.salomAdminUserId, {
      notes: body.notes !== undefined ? body.notes : undefined,
    });
  }

  @Get("reports/daily")
  daily(@Query("days") days?: string) {
    const d = days ? parseInt(days, 10) : 7;
    return this.admin.dailyOrderStats(Number.isNaN(d) ? 7 : d);
  }

  @Get("reports/pilot")
  pilot(@Query("days") days?: string) {
    const d = days ? parseInt(days, 10) : 14;
    return this.admin.pilotOpsReport(Number.isNaN(d) ? 14 : d);
  }

  @Get("reports/daily.csv")
  async exportDaily(
    @Query("days") days: string | undefined,
    @Res() res: Response,
  ) {
    const d = days ? parseInt(days, 10) : 7;
    const n = Number.isNaN(d) ? 7 : d;
    const csv = await this.admin.exportDailyOrderStatsCsv(n);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="salom-daily-orders.csv"',
    );
    return res.send(csv);
  }

  @Get("reports/pilot.csv")
  async exportPilot(
    @Query("days") days: string | undefined,
    @Res() res: Response,
  ) {
    const d = days ? parseInt(days, 10) : 14;
    const n = Number.isNaN(d) ? 14 : d;
    const csv = await this.admin.exportPilotReportCsv(n);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="salom-pilot-report.csv"',
    );
    return res.send(csv);
  }

  @Get("drivers/pending")
  driversPending() {
    return this.admin.listPendingDrivers();
  }

  @Get("drivers")
  drivers(
    @Query("take") take?: string,
    @Query("skip") skip?: string,
    @Query("q") q?: string,
    @Query("zoneId") zoneId?: string,
    @Query("accountStatus") accountStatus?: string,
    @Query("onboardingStatus") onboardingStatus?: string,
  ) {
    const t = take ? parseInt(take, 10) : 30;
    const s = skip ? parseInt(skip, 10) : 0;
    let ac: UserAccountStatus | undefined;
    if (
      accountStatus &&
      Object.values(UserAccountStatus).includes(
        accountStatus as UserAccountStatus,
      )
    ) {
      ac = accountStatus as UserAccountStatus;
    }
    let ob: DriverOnboardingStatus | undefined;
    if (
      onboardingStatus &&
      Object.values(DriverOnboardingStatus).includes(
        onboardingStatus as DriverOnboardingStatus,
      )
    ) {
      ob = onboardingStatus as DriverOnboardingStatus;
    }
    return this.admin.listDrivers({
      take: Math.min(Math.max(t, 1), 100),
      skip: Math.max(s, 0),
      q,
      zoneId,
      accountStatus: ac,
      onboardingStatus: ob,
    });
  }

  @Post("drivers")
  @HttpCode(201)
  createDriver(@Body() body: CreateDriverAdminDto, @Req() req: Request) {
    return this.admin.createDriverByAdmin(body, req.salomAdminUserId);
  }

  /** Haydovchi yuklagan rasm / fayl (diskdan); brauzerda `Authorization: Bearer` bilan yoki blob orqali. */
  @Get("drivers/:driverId/documents/:docId/file")
  async driverDocumentFile(
    @Param("driverId") driverId: string,
    @Param("docId") docId: string,
  ): Promise<StreamableFile> {
    const { stream, mimeType } = await this.admin.openDriverDocumentStream(
      driverId,
      docId,
    );
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: `inline; filename="doc-${docId}"`,
    });
  }

  @Post("drivers/:driverId/documents/upload")
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadDriverDocument(
    @Param("driverId") driverId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadDriverDocBodyDto,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("file maydoni majburiy");
    }
    return this.onboarding.uploadDocumentFileAsAdmin(driverId, body.type, file);
  }

  @Delete("drivers/:driverId/documents/:docId")
  @HttpCode(200)
  deleteDriverDocument(
    @Param("driverId") driverId: string,
    @Param("docId") docId: string,
  ) {
    return this.onboarding.deleteDocumentAsAdmin(driverId, docId);
  }

  @Get("drivers/:id")
  driver(@Param("id") id: string) {
    return this.admin.getDriver(id);
  }

  @Post("drivers/:id/vehicles")
  @HttpCode(201)
  addDriverVehicle(
    @Param("id") id: string,
    @Body() body: AdminCreateVehicleDto,
    @Req() req: Request,
  ) {
    return this.admin.addDriverVehicle(id, body, req.salomAdminUserId);
  }

  @Patch("drivers/:id/vehicles/:vehicleId")
  patchDriverVehicle(
    @Param("id") id: string,
    @Param("vehicleId") vehicleId: string,
    @Body() body: AdminPatchVehicleDto,
    @Req() req: Request,
  ) {
    return this.admin.updateDriverVehicle(
      id,
      vehicleId,
      body,
      req.salomAdminUserId,
    );
  }

  @Delete("drivers/:id/vehicles/:vehicleId")
  @HttpCode(200)
  removeDriverVehicle(
    @Param("id") id: string,
    @Param("vehicleId") vehicleId: string,
    @Req() req: Request,
  ) {
    return this.admin.removeDriverVehicle(id, vehicleId, req.salomAdminUserId);
  }

  @Post("drivers/:id/approve")
  approveDriver(@Param("id") id: string, @Req() req: Request) {
    return this.admin.approveDriver(id, req.salomAdminUserId);
  }

  @Post("drivers/:id/reject")
  rejectDriver(
    @Param("id") id: string,
    @Body() body: RejectDriverDto,
    @Req() req: Request,
  ) {
    return this.admin.rejectDriver(id, body.reason, req.salomAdminUserId);
  }

  @Post("drivers/:id/under-review")
  underReview(@Param("id") id: string, @Req() req: Request) {
    return this.admin.setDriverUnderReview(id, req.salomAdminUserId);
  }

  @Post("drivers/:id/suspend")
  suspendDriver(@Param("id") id: string, @Req() req: Request) {
    return this.admin.suspendDriver(id, req.salomAdminUserId);
  }

  @Patch("drivers/:id/payout-destination")
  patchDriverPayout(
    @Param("id") id: string,
    @Body() body: UpdateDriverPayoutAdminDto,
    @Req() req: Request,
  ) {
    return this.admin.updateDriverPayoutDestinationByAdmin(
      id,
      body,
      req.salomAdminUserId,
    );
  }

  @Delete("drivers/:id")
  @HttpCode(200)
  deleteDriver(@Param("id") id: string, @Req() req: Request) {
    return this.admin.deleteDriverAccount(id, req.salomAdminUserId);
  }

  @Post("notifications/driver-broadcast")
  @HttpCode(200)
  driverBroadcast(@Body() body: SendDriverBroadcastDto, @Req() req: Request) {
    return this.admin.sendDriverBroadcast(body, req.salomAdminUserId);
  }

  @Get("notifications/driver-news")
  listDriverNews(@Query("take") take?: string, @Query("skip") skip?: string) {
    const t = take ? parseInt(take, 10) : 50;
    const s = skip ? parseInt(skip, 10) : 0;
    return this.admin.listAdminDriverNews(
      Number.isFinite(t) ? t : 50,
      Number.isFinite(s) ? s : 0,
    );
  }

  @Patch("notifications/driver-news/:id")
  @HttpCode(200)
  patchDriverNews(
    @Param("id") id: string,
    @Body() body: UpdateAdminDriverNewsDto,
    @Req() req: Request,
  ) {
    return this.admin.updateAdminDriverNews(id, body, req.salomAdminUserId);
  }

  @Delete("notifications/driver-news/:id")
  @HttpCode(200)
  deleteDriverNews(@Param("id") id: string, @Req() req: Request) {
    return this.admin.deleteAdminDriverNews(id, req.salomAdminUserId);
  }

  @Post("notifications/sms-test")
  @HttpCode(200)
  postSmsTest(@Body() body: TestSmsDto, @Req() req: Request) {
    return this.admin.sendTestSms(
      body.toPhone,
      body.body,
      req.salomAdminUserId,
    );
  }

  @Patch("zones/:id/meter")
  patchZoneMeter(
    @Param("id") id: string,
    @Body() body: UpdateZoneMeterDto,
    @Req() req: Request,
  ) {
    return this.admin.updateZoneMeter(id, body, req.salomAdminUserId);
  }

  @Get("zones")
  zones() {
    return this.admin.listZones();
  }

  @Post("zones")
  @HttpCode(201)
  createZone(@Body() body: CreateServiceZoneDto, @Req() req: Request) {
    return this.admin.createServiceZone(
      {
        name: body.name,
        slug: body.slug,
        centerLat: body.centerLat,
        centerLng: body.centerLng,
        isActive: body.isActive,
      },
      req.salomAdminUserId,
    );
  }

  @Get("zones/:id/pickup-pricing")
  getZonePickupPricing(@Param("id") id: string) {
    return this.admin.getZonePickupPricing(id);
  }

  @Patch("zones/:id/pickup-pricing")
  @HttpCode(200)
  patchZonePickupPricing(
    @Param("id") id: string,
    @Body() body: PatchZonePickupPricingDto,
    @Req() req: Request,
  ) {
    return this.admin.patchZonePickupPricing(id, body, req.salomAdminUserId);
  }

  @Post("zones/:id/pickup-pricing/rings")
  @HttpCode(201)
  createPickupRing(
    @Param("id") id: string,
    @Body() body: CreatePickupPricingRingDto,
    @Req() req: Request,
  ) {
    return this.admin.createPickupPricingRing(id, body, req.salomAdminUserId);
  }

  @Patch("pickup-pricing/rings/:ringId")
  @HttpCode(200)
  patchPickupRing(
    @Param("ringId") ringId: string,
    @Body() body: UpdatePickupPricingRingDto,
    @Req() req: Request,
  ) {
    return this.admin.patchPickupPricingRing(
      ringId,
      body,
      req.salomAdminUserId,
    );
  }

  @Delete("pickup-pricing/rings/:ringId")
  @HttpCode(200)
  deletePickupRing(@Param("ringId") ringId: string, @Req() req: Request) {
    return this.admin.deletePickupPricingRing(ringId, req.salomAdminUserId);
  }

  @Get("operators")
  operators() {
    return this.admin.listOperators();
  }

  @Post("operators")
  @HttpCode(201)
  createOperator(@Body() body: CreateOperatorDto, @Req() req: Request) {
    return this.admin.createOperator(body, req.salomAdminUserId);
  }

  @Patch("operators/:id")
  patchOperator(
    @Param("id") id: string,
    @Body() body: UpdateOperatorDto,
    @Req() req: Request,
  ) {
    return this.admin.updateOperator(id, body, req.salomAdminUserId);
  }

  @Post("operators/:id/activate")
  @HttpCode(200)
  activateOperator(@Param("id") id: string, @Req() req: Request) {
    return this.admin.setOperatorStatus(
      id,
      UserAccountStatus.ACTIVE,
      req.salomAdminUserId,
    );
  }

  @Post("operators/:id/suspend")
  @HttpCode(200)
  suspendOperator(@Param("id") id: string, @Req() req: Request) {
    return this.admin.setOperatorStatus(
      id,
      UserAccountStatus.SUSPENDED,
      req.salomAdminUserId,
    );
  }

  @Delete("operators/:id")
  @HttpCode(200)
  deleteOperator(@Param("id") id: string, @Req() req: Request) {
    return this.admin.deleteOperator(id, req.salomAdminUserId);
  }

  @Get("vehicles")
  async vehicles(
    @Query("take") take?: string,
    @Query("skip") skip?: string,
    @Query("q") q?: string,
  ) {
    const t = take ? parseInt(take, 10) : 50;
    const s = skip ? parseInt(skip, 10) : 0;
    const [items, total] = await this.admin.listVehicles({
      take: Math.min(Math.max(t, 1), 100),
      skip: Math.max(s, 0),
      q,
    });
    return { total, items };
  }

  @Get("subscription-packages")
  packages() {
    return this.admin.listSubscriptionPackages();
  }

  @Get("subscriptions")
  async subscriptions(
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    const t = take ? parseInt(take, 10) : 50;
    const s = skip ? parseInt(skip, 10) : 0;
    const [items, total] = await this.admin.listSubscriptions({
      take: Math.min(Math.max(t, 1), 100),
      skip: Math.max(s, 0),
    });
    return { total, items };
  }

  @Get("finance/summary")
  finance() {
    return this.admin.financeSummary();
  }

  @Get("finance/payouts-recent")
  payoutsRecent(@Query("take") take?: string) {
    const t = take ? parseInt(take, 10) : 30;
    return this.admin.listRecentPayouts(Number.isNaN(t) ? 30 : t);
  }

  @Get("finance/adjustments-recent")
  adjustmentsRecent(@Query("take") take?: string) {
    const t = take ? parseInt(take, 10) : 30;
    return this.admin.listRecentAdjustments(Number.isNaN(t) ? 30 : t);
  }

  @Get("finance/top-ups-recent")
  topUpsRecent(@Query("take") take?: string) {
    const t = take ? parseInt(take, 10) : 30;
    return this.admin.listRecentTopUps(Number.isNaN(t) ? 30 : t);
  }

  @Get("finance/ledger")
  financeLedger(
    @Query("take") take?: string,
    @Query("skip") skip?: string,
    @Query("driverId") driverId?: string,
    @Query("type") type?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("q") q?: string,
  ) {
    const t = take ? parseInt(take, 10) : 50;
    const s = skip ? parseInt(skip, 10) : 0;
    return this.admin.listFinanceLedger({
      take: Number.isNaN(t) ? 50 : t,
      skip: Number.isNaN(s) ? 0 : s,
      driverId,
      type,
      from,
      to,
      q,
    });
  }

  @Get("finance/reconcile/:driverId")
  reconcileDriverBalance(@Param("driverId") driverId: string) {
    return this.admin.reconcileDriverBalance(driverId);
  }

  @Get("notifications/sms-logs")
  smsLogs(@Query("take") take?: string, @Query("status") status?: string) {
    const t = take ? parseInt(take, 10) : 100;
    return this.admin.listSmsLogs(Number.isNaN(t) ? 100 : t, status);
  }

  @Get("finance/export/ledger.csv")
  async exportLedger(
    @Query("take") take: string | undefined,
    @Query("driverId") driverId: string | undefined,
    @Query("type") type: string | undefined,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Query("q") q: string | undefined,
    @Res() res: Response,
  ) {
    const t = take ? parseInt(take, 10) : 1000;
    const csv = await this.admin.exportLedgerCsv({
      take: Number.isNaN(t) ? 1000 : t,
      driverId,
      type,
      from,
      to,
      q,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="salom-ledger.csv"',
    );
    return res.send(csv);
  }

  @Get("finance/export/payouts-bank.csv")
  async exportPayoutsBank(
    @Query("take") take: string | undefined,
    @Res() res: Response,
  ) {
    const t = take ? parseInt(take, 10) : 500;
    const csv = await this.admin.exportPayoutsBankBatchCsv(
      Number.isNaN(t) ? 500 : t,
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="salom-payouts-bank.csv"',
    );
    return res.send(csv);
  }

  @Get("finance/balances-top")
  balancesTop(@Query("take") take?: string) {
    const t = take ? parseInt(take, 10) : 20;
    return this.admin.listTopDriverBalances(Number.isNaN(t) ? 20 : t);
  }

  @Post("finance/payout-record")
  recordPayout(@Body() body: RecordPayoutDto, @Req() req: Request) {
    return this.admin.recordPayout(body, req.salomAdminUserId);
  }

  @Post("finance/top-up-record")
  recordTopUp(@Body() body: RecordTopUpDto, @Req() req: Request) {
    return this.admin.recordTopUp(body, req.salomAdminUserId);
  }

  @Post("finance/ledger-adjustment")
  recordAdjustment(
    @Body() body: RecordLedgerAdjustmentDto,
    @Req() req: Request,
  ) {
    return this.admin.recordLedgerAdjustment(body, req.salomAdminUserId);
  }

  @Get("sms-templates")
  smsTemplates() {
    return this.admin.listSmsTemplates();
  }

  @Patch("sms-templates/:code")
  patchSms(
    @Param("code") code: string,
    @Body() body: PatchSmsTemplateDto,
    @Req() req: Request,
  ) {
    return this.admin.updateSmsTemplate(
      decodeURIComponent(code),
      body,
      req.salomAdminUserId,
    );
  }

  @Get("audit-logs")
  audit(@Query("take") take?: string, @Query("action") action?: string) {
    const t = take ? parseInt(take, 10) : 50;
    return this.admin.listAuditLogs(Number.isNaN(t) ? 50 : t, action);
  }
}
