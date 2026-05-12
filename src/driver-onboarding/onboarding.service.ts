import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Express } from "express";
import {
  DriverDocumentStatus,
  DriverDocumentType,
  DriverOnboardingStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { driverDocumentsUploadRoot } from "../config/local-upload-paths";
import { AddDriverDocumentDto } from "./dto/add-driver-document.dto";
import { PatchDriverOnboardingDto } from "./dto/patch-onboarding.dto";

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(driverId: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        user: { select: { phone: true, status: true } },
        serviceZone: { select: { id: true, name: true, slug: true } },
        vehicles: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 2,
        },
        documents: { take: 20, orderBy: { createdAt: "desc" } },
      },
    });
    if (!d) {
      throw new NotFoundException();
    }
    return {
      onboardingStatus: d.onboardingStatus,
      userStatus: d.user.status,
      phone: d.user.phone,
      firstName: d.firstName,
      lastName: d.lastName,
      passportOrId: d.passportOrId,
      referralNote: d.referralNote,
      submittedAt: d.submittedAt,
      reviewedAt: d.reviewedAt,
      rejectionReason: d.rejectionReason,
      needsActivation: Boolean(d.activationCode && !d.appActivatedAt),
      serviceZone: d.serviceZone,
      vehicles: d.vehicles,
      documents: d.documents.map((x) => ({
        id: x.id,
        type: x.type,
        status: x.status,
        createdAt: x.createdAt,
      })),
    };
  }

  private assertEditable(d: { onboardingStatus: DriverOnboardingStatus }) {
    const ok: DriverOnboardingStatus[] = [
      DriverOnboardingStatus.DRAFT,
      DriverOnboardingStatus.REJECTED,
    ];
    if (!ok.includes(d.onboardingStatus)) {
      throw new ForbiddenException(
        "Ariza faqat DRAFT yoki QAYTA TUZATISH (rad) holatida tahrirlanadi",
      );
    }
  }

  async patchProfile(driverId: string, dto: PatchDriverOnboardingDto) {
    const d = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!d) {
      throw new NotFoundException();
    }
    this.assertEditable(d);
    const data: Prisma.DriverUpdateInput = {};
    if (dto.firstName !== undefined) {
      data.firstName = dto.firstName.trim() || null;
    }
    if (dto.lastName !== undefined) {
      data.lastName = dto.lastName.trim() || null;
    }
    if (dto.passportOrId !== undefined) {
      data.passportOrId = dto.passportOrId.trim() || null;
    }
    if (dto.referralNote !== undefined) {
      data.referralNote = dto.referralNote.trim() || null;
    }
    if (dto.serviceZoneId !== undefined) {
      data.serviceZone = dto.serviceZoneId
        ? { connect: { id: dto.serviceZoneId } }
        : { disconnect: true };
    }
    if (d.onboardingStatus === DriverOnboardingStatus.REJECTED) {
      data.onboardingStatus = DriverOnboardingStatus.DRAFT;
      data.rejectionReason = null;
    }
    const updated = await this.prisma.driver.update({
      where: { id: driverId },
      data,
    });
    if (dto.vehiclePlate?.trim() && dto.vehicleMakeModel?.trim()) {
      const existing = await this.prisma.vehicle.findFirst({
        where: { driverId, isActive: true },
      });
      const vdata = {
        plate: dto.vehiclePlate.trim(),
        plateRegionCode: dto.vehiclePlateRegionCode?.trim() || null,
        makeModel: dto.vehicleMakeModel.trim(),
        year: dto.vehicleYear ?? null,
        color: dto.vehicleColor?.trim() ?? null,
        serviceZoneId: updated.serviceZoneId,
      };
      if (existing) {
        await this.prisma.vehicle.update({
          where: { id: existing.id },
          data: vdata,
        });
      } else {
        await this.prisma.vehicle.create({
          data: {
            driverId,
            ...vdata,
            isActive: true,
          },
        });
      }
    }
    return this.getSnapshot(driverId);
  }

  async submitForReview(driverId: string) {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { vehicles: { where: { isActive: true }, take: 1 } },
    });
    if (!d) {
      throw new NotFoundException();
    }
    if (d.onboardingStatus !== DriverOnboardingStatus.DRAFT) {
      throw new BadRequestException("Faqat DRAFT holatda yuborish mumkin");
    }
    if (!d.firstName?.trim() || !d.lastName?.trim() || !d.serviceZoneId) {
      throw new BadRequestException("Majburiy: ism, familiya, xizmat zonasi");
    }
    if (!d.vehicles.length) {
      throw new BadRequestException(
        "Majburiy: transport (davlat raqami, model)",
      );
    }
    if (!d.passportOrId?.trim()) {
      throw new BadRequestException("Majburiy: pasport yoki ID");
    }
    const docTypes = await this.prisma.driverDocument.findMany({
      where: { driverId },
      select: { type: true },
      distinct: ["type"],
    });
    const have = new Set(docTypes.map((x) => x.type));
    const need: DriverDocumentType[] = [
      DriverDocumentType.LICENSE_FRONT,
      DriverDocumentType.LICENSE_BACK,
      DriverDocumentType.LICENSE_HOLD,
    ];
    if (!need.every((t) => have.has(t))) {
      throw new BadRequestException(
        "Majburiy: guvohnomaning oldi, orqa tomoni va o‘zingiz guvohnomani ushlab turganingizdagi 3 alohida surat",
      );
    }
    await this.prisma.driver.update({
      where: { id: driverId },
      data: {
        onboardingStatus: DriverOnboardingStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    });
    return this.getSnapshot(driverId);
  }

  async addDocument(driverId: string, dto: AddDriverDocumentDto) {
    const d = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!d) {
      throw new NotFoundException();
    }
    this.assertEditable(d);
    await this.prisma.driverDocument.create({
      data: {
        driverId,
        type: dto.type,
        storageKey: dto.storageKey.trim(),
        status: DriverDocumentStatus.PENDING,
      },
    });
    return this.getSnapshot(driverId);
  }

  /** Faylni lokal disklarga yozadi, `DriverDocument` yozuvi `storageKey` sifatida nisbiy yo‘l saqlanadi. */
  async uploadDocumentFile(
    driverId: string,
    type: DriverDocumentType,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Fayl bo‘sh");
    }
    const d = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!d) {
      throw new NotFoundException();
    }
    this.assertEditable(d);
    const extRaw = path.extname(file.originalname || "") || ".jpg";
    const safeExt =
      extRaw.length <= 8 && extRaw.startsWith(".") ? extRaw : ".jpg";
    const key = `driver-docs/${driverId}/${randomUUID()}${safeExt}`;
    const root = driverDocumentsUploadRoot();
    const full = path.join(root, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, file.buffer);
    await this.prisma.driverDocument.create({
      data: {
        driverId,
        type,
        storageKey: key,
        status: DriverDocumentStatus.PENDING,
      },
    });
    return this.getSnapshot(driverId);
  }

  /** Administrator haydovchi uchun hujjat yuklash (onboarding holatidan qat’i nazar). */
  async uploadDocumentFileAsAdmin(
    driverId: string,
    type: DriverDocumentType,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Fayl bo‘sh");
    }
    const d = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!d) {
      throw new NotFoundException();
    }
    const extRaw = path.extname(file.originalname || "") || ".jpg";
    const safeExt =
      extRaw.length <= 8 && extRaw.startsWith(".") ? extRaw : ".jpg";
    const key = `driver-docs/${driverId}/${randomUUID()}${safeExt}`;
    const root = driverDocumentsUploadRoot();
    const full = path.join(root, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, file.buffer);
    await this.prisma.driverDocument.create({
      data: {
        driverId,
        type,
        storageKey: key,
        status: DriverDocumentStatus.PENDING,
      },
    });
    return this.getSnapshot(driverId);
  }

  /** Administrator haydovchi hujjatini o‘chirish (disk + yozuv). */
  async deleteDocumentAsAdmin(driverId: string, documentId: string) {
    const doc = await this.prisma.driverDocument.findFirst({
      where: { id: documentId, driverId },
    });
    if (!doc) {
      throw new NotFoundException();
    }
    const root = driverDocumentsUploadRoot();
    const rel = doc.storageKey.replace(/^[\\/]+/, "");
    const full = path.resolve(path.join(root, rel));
    const relative = path.relative(root, full);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ForbiddenException("Invalid storage path");
    }
    await fs.unlink(full).catch(() => undefined);
    await this.prisma.driverDocument.delete({ where: { id: documentId } });
    return this.getSnapshot(driverId);
  }
}
