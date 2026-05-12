import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Express, Request } from "express";
import { SalomDriverGuard } from "../tracking/guards/salom-driver.guard";
import { OnboardingService } from "./onboarding.service";
import { PatchDriverOnboardingDto } from "./dto/patch-onboarding.dto";
import { AddDriverDocumentDto } from "./dto/add-driver-document.dto";
import { UploadDriverDocBodyDto } from "./dto/upload-driver-doc-body.dto";

@Controller({ path: "drivers/me/onboarding", version: "1" })
@UseGuards(SalomDriverGuard)
export class DriverOnboardingMeController {
  constructor(private readonly ob: OnboardingService) {}

  @Get()
  get(@Req() req: Request) {
    return this.ob.getSnapshot(req.salomDriverId!);
  }

  @Patch()
  patch(@Req() req: Request, @Body() body: PatchDriverOnboardingDto) {
    return this.ob.patchProfile(req.salomDriverId!, body);
  }

  @Post("submit")
  submit(@Req() req: Request) {
    return this.ob.submitForReview(req.salomDriverId!);
  }

  @Post("documents")
  addDoc(@Req() req: Request, @Body() body: AddDriverDocumentDto) {
    return this.ob.addDocument(req.salomDriverId!, body);
  }

  @Post("documents/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadDoc(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadDriverDocBodyDto,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("file maydoni majburiy");
    }
    return this.ob.uploadDocumentFile(req.salomDriverId!, body.type, file);
  }
}
