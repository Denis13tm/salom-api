import { ConflictException, Injectable } from '@nestjs/common';
import { DriverOnboardingStatus, UserAccountStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhoneUz } from './phone.util';
import { RegisterDriverDto } from './dto/register-driver.dto';

@Injectable()
export class RegistrationService {
  constructor(private readonly prisma: PrismaService) {}

  async publicRegister(dto: RegisterDriverDto) {
    const phone = normalizePhoneUz(dto.phone);
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) {
      if (existing.role === UserRole.DRIVER) {
        throw new ConflictException('Ushbu raqam bilan haydovchi allaqachon mavjud');
      }
      throw new ConflictException('Telefon allaqachon ro‘yxatda');
    }
    const user = await this.prisma.user.create({
      data: {
        phone,
        role: UserRole.DRIVER,
        status: UserAccountStatus.PENDING_VERIFICATION,
      },
    });
    const driver = await this.prisma.driver.create({
      data: {
        userId: user.id,
        onboardingStatus: DriverOnboardingStatus.DRAFT,
        firstName: dto.firstName?.trim() || null,
        lastName: dto.lastName?.trim() || null,
      },
    });
    return {
      ok: true as const,
      driverId: driver.id,
      message: 'Keyingi qadam: POST /api/v1/auth/driver/registration/otp/request (SMS kod)',
    };
  }
}
