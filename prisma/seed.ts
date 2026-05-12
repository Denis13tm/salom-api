import { createHash } from 'node:crypto';
import {
  Prisma,
  PrismaClient,
  DriverOnboardingStatus,
  DriverOperationalStatus,
  DriverSubscriptionStatus,
  OrderStatus,
  TripStatus,
  UserAccountStatus,
  UserRole,
} from '@prisma/client';

const prisma = new PrismaClient();

/** Deterministic UUID for idempotent seed rows (Postgres accepts arbitrary v4-shaped strings). */
function seedUuid(seed: string): string {
  const h = createHash('sha256').update(`salom-taxi-seed:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Joriy oy (UTC) — oylik chempionlar leaderboard bilan bir xil */
function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

const IDS = {
  zone: 'a0000000-0000-4000-8000-000000000001',
  /** Qo'shimcha demo zona (operator UI da nom bilan tanlanadi) */
  zoneGallaorol: 'a0000000-0000-4000-8000-000000200001',
  pricingGuliston: 'a0000000-0000-4000-8000-000000300001',
  pricingGallaorol: 'a0000000-0000-4000-8000-000000300002',
  userAdmin: 'a0000000-0000-4000-8000-000000000010',
  userOp: 'a0000000-0000-4000-8000-000000000011',
  userD1: 'a0000000-0000-4000-8000-000000000012',
  userD2: 'a0000000-0000-4000-8000-000000000013',
  admin: 'a0000000-0000-4000-8000-000000000020',
  operator: 'a0000000-0000-4000-8000-000000000021',
  driver1: 'a0000000-0000-4000-8000-000000000031',
  driver2: 'a0000000-0000-4000-8000-000000000032',
  veh1: 'a0000000-0000-4000-8000-000000000041',
  pkgBasic: 'a0000000-0000-4000-8000-000000000050',
  subD1: 'a0000000-0000-4000-8000-000000000051',
  canc1: 'a0000000-0000-4000-8000-000000000060',
  canc2: 'a0000000-0000-4000-8000-000000000061',
  order1: 'a0000000-0000-4000-8000-000000000070',
} as const;

async function main() {
  await prisma.platformSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', platformCommissionBps: 1000 },
    update: {},
  });

  const gulistonZone = await prisma.serviceZone.upsert({
    where: { slug: 'gulistan-demo' },
    create: {
      id: IDS.zone,
      name: 'Guliston',
      slug: 'gulistan-demo',
      centerLat: new Prisma.Decimal(40.4875),
      centerLng: new Prisma.Decimal(68.7845),
      starterFeeUzs: new Prisma.Decimal(6000),
      waitingFreeMinutes: 10,
      waitingFeePerMinuteUzs: new Prisma.Decimal(1000),
      isActive: true,
    },
    update: {
      name: 'Guliston',
      centerLat: new Prisma.Decimal(40.4875),
      centerLng: new Prisma.Decimal(68.7845),
      starterFeeUzs: new Prisma.Decimal(6000),
      waitingFreeMinutes: 10,
      waitingFeePerMinuteUzs: new Prisma.Decimal(1000),
    },
  });

  const gallaorolZone = await prisma.serviceZone.upsert({
    where: { slug: 'gallaorol-seed' },
    create: {
      id: IDS.zoneGallaorol,
      name: "G'allaorol",
      slug: 'gallaorol-seed',
      centerLat: new Prisma.Decimal(40.125),
      centerLng: new Prisma.Decimal(67.83),
      starterFeeUzs: new Prisma.Decimal(6000),
      waitingFreeMinutes: 10,
      waitingFeePerMinuteUzs: new Prisma.Decimal(1000),
      isActive: true,
    },
    update: {
      name: "G'allaorol",
      centerLat: new Prisma.Decimal(40.125),
      centerLng: new Prisma.Decimal(67.83),
      starterFeeUzs: new Prisma.Decimal(6000),
      waitingFreeMinutes: 10,
      waitingFeePerMinuteUzs: new Prisma.Decimal(1000),
    },
  });

  for (const z of [
    { zone: gulistonZone, profileId: IDS.pricingGuliston, cityStarter: 6000 },
    { zone: gallaorolZone, profileId: IDS.pricingGallaorol, cityStarter: 6000 },
  ]) {
    await prisma.pricingProfile.updateMany({
      where: { serviceZoneId: z.zone.id, id: { not: z.profileId } },
      data: { isDefault: false },
    });
    await prisma.pricingProfile.upsert({
      where: { id: z.profileId },
      create: {
        id: z.profileId,
        serviceZoneId: z.zone.id,
        name: `${z.zone.name} default`,
        cityKmRateUzs: new Prisma.Decimal(2500),
        outsideKmRateUzs: new Prisma.Decimal(3500),
        freeWaitMinutes: 10,
        waitPerMinuteUzs: new Prisma.Decimal(1000),
        isDefault: true,
        isActive: true,
        rings: {
          create: [
            {
              code: 'city',
              name: 'Shahar ichi',
              radiusFromKm: new Prisma.Decimal(0),
              radiusToKm: new Prisma.Decimal(5),
              starterFeeUzs: new Prisma.Decimal(z.cityStarter),
              distanceRateUzs: new Prisma.Decimal(2500),
              sortOrder: 10,
            },
            {
              code: 'edge',
              name: 'Shahar chekasi',
              radiusFromKm: new Prisma.Decimal(5),
              radiusToKm: new Prisma.Decimal(8),
              starterFeeUzs: new Prisma.Decimal(7000),
              distanceRateUzs: new Prisma.Decimal(2500),
              sortOrder: 20,
            },
            {
              code: 'outer_1',
              name: 'Shahar tashqarisi 1',
              radiusFromKm: new Prisma.Decimal(8),
              radiusToKm: new Prisma.Decimal(15),
              starterFeeUzs: new Prisma.Decimal(10000),
              distanceRateUzs: new Prisma.Decimal(3500),
              sortOrder: 30,
            },
            {
              code: 'outer_2',
              name: 'Shahar tashqarisi 2',
              radiusFromKm: new Prisma.Decimal(15),
              radiusToKm: new Prisma.Decimal(25),
              starterFeeUzs: new Prisma.Decimal(15000),
              distanceRateUzs: new Prisma.Decimal(3500),
              sortOrder: 40,
            },
            {
              code: 'special',
              name: '25 km+ / maxsus',
              radiusFromKm: new Prisma.Decimal(25),
              radiusToKm: null,
              starterFeeUzs: new Prisma.Decimal(20000),
              distanceRateUzs: new Prisma.Decimal(3500),
              sortOrder: 50,
            },
          ],
        },
      },
      update: {
        name: `${z.zone.name} default`,
        cityKmRateUzs: new Prisma.Decimal(2500),
        outsideKmRateUzs: new Prisma.Decimal(3500),
        freeWaitMinutes: 10,
        waitPerMinuteUzs: new Prisma.Decimal(1000),
        isDefault: true,
        isActive: true,
      },
    });
  }

  await prisma.user.upsert({
    where: { phone: '+998900000000' },
    create: {
      id: IDS.userAdmin,
      phone: '+998900000000',
      role: UserRole.SUPER_ADMIN,
      status: UserAccountStatus.ACTIVE,
    },
    update: { status: UserAccountStatus.ACTIVE },
  });

  await prisma.user.upsert({
    where: { phone: '+998900000001' },
    create: {
      id: IDS.userOp,
      phone: '+998900000001',
      role: UserRole.OPERATOR,
      status: UserAccountStatus.ACTIVE,
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { phone: '+998900000010' },
    create: {
      id: IDS.userD1,
      phone: '+998900000010',
      role: UserRole.DRIVER,
      status: UserAccountStatus.ACTIVE,
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { phone: '+998900000011' },
    create: {
      id: IDS.userD2,
      phone: '+998900000011',
      role: UserRole.DRIVER,
      status: UserAccountStatus.ACTIVE,
    },
    update: {},
  });

  await prisma.admin.upsert({
    where: { userId: IDS.userAdmin },
    create: { id: IDS.admin, userId: IDS.userAdmin, title: 'Seed' },
    update: {},
  });

  const operator = await prisma.operator.upsert({
    where: { userId: IDS.userOp },
    create: {
      id: IDS.operator,
      userId: IDS.userOp,
      serviceZoneId: IDS.zoneGallaorol,
      displayName: 'Operatsionist 1',
    },
    update: { displayName: 'Operatsionist 1', serviceZoneId: IDS.zoneGallaorol },
  });

  await prisma.driver.upsert({
    where: { userId: IDS.userD1 },
    create: {
      id: IDS.driver1,
      userId: IDS.userD1,
      serviceZoneId: IDS.zoneGallaorol,
      operationalStatus: DriverOperationalStatus.ONLINE_IDLE,
      onboardingStatus: DriverOnboardingStatus.APPROVED,
      appActivatedAt: new Date(),
    },
    update: {
      serviceZoneId: IDS.zoneGallaorol,
      onboardingStatus: DriverOnboardingStatus.APPROVED,
      appActivatedAt: new Date(),
    },
  });

  await prisma.driver.upsert({
    where: { userId: IDS.userD2 },
    create: {
      id: IDS.driver2,
      userId: IDS.userD2,
      serviceZoneId: IDS.zoneGallaorol,
      operationalStatus: DriverOperationalStatus.OFFLINE,
      onboardingStatus: DriverOnboardingStatus.APPROVED,
      appActivatedAt: new Date(),
    },
    update: {
      serviceZoneId: IDS.zoneGallaorol,
      onboardingStatus: DriverOnboardingStatus.APPROVED,
      appActivatedAt: new Date(),
    },
  });

  await prisma.vehicle.upsert({
    where: { id: IDS.veh1 },
    create: {
      id: IDS.veh1,
      driverId: IDS.driver1,
      serviceZoneId: IDS.zoneGallaorol,
      plate: '40A 777 AA',
      makeModel: 'Cobalt',
      year: 2020,
      color: 'Kulrang',
    },
    update: { serviceZoneId: IDS.zoneGallaorol },
  });

  const pkg = await prisma.subscriptionPackage.upsert({
    where: { id: IDS.pkgBasic },
    create: {
      id: IDS.pkgBasic,
      name: 'Baza ustunlik',
      priorityWeight: new Prisma.Decimal(1.2),
      priceUzs: new Prisma.Decimal(200_000),
      durationDays: 30,
    },
    update: {},
  });

  const now = new Date();
  const end = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
  await prisma.driverSubscription.upsert({
    where: { id: IDS.subD1 },
    create: {
      id: IDS.subD1,
      driverId: IDS.driver1,
      packageId: pkg.id,
      serviceZoneId: IDS.zoneGallaorol,
      status: DriverSubscriptionStatus.ACTIVE,
      startAt: now,
      endAt: end,
    },
    update: { endAt: end, serviceZoneId: IDS.zoneGallaorol },
  });

  await prisma.cancellationReason.upsert({
    where: { id: IDS.canc1 },
    create: {
      id: IDS.canc1,
      code: 'no_driver',
      labelUz: "Haydovchi yo'q / kutishdan charchadi",
      sortOrder: 1,
    },
    update: {},
  });
  await prisma.cancellationReason.upsert({
    where: { id: IDS.canc2 },
    create: {
      id: IDS.canc2,
      code: 'passenger_no_show',
      labelUz: "Yo'lovchi kelmadi (no-show)",
      sortOrder: 2,
    },
    update: { code: 'passenger_no_show' },
  });

  await prisma.order.upsert({
    where: { id: IDS.order1 },
    create: {
      id: IDS.order1,
      serviceZoneId: IDS.zoneGallaorol,
      status: OrderStatus.CREATED,
      customerPhone: '+998911112233',
      pickupLandmark: "Do'stlik bog'i oldi",
      dropoffText: 'Maktab yo‘nalish',
      paymentType: 'CASH',
      fareMode: 'METERED',
      createdByOperatorId: operator.id,
    },
    update: { serviceZoneId: IDS.zoneGallaorol },
  });

  await prisma.order.deleteMany({
    where: { pickupLandmark: { contains: '[seed-mock]' } },
  });

  const monthStart = startOfMonthUtc(now);
  const monthEnd = endOfMonthUtc(now);
  const effectiveEnd = new Date(Math.min(now.getTime(), monthEnd.getTime() - 5000));
  const windowMs = Math.max(120_000, effectiveEnd.getTime() - monthStart.getTime());

  const MOCK_CHAMPION_DRIVERS: {
    phone: string;
    firstName: string;
    lastName: string;
    rating: string;
    trips: number;
    plate: string;
    plateRegionCode: string;
    makeModel: string;
    vehicleYear: number;
    vehicleColor: string;
    passportSeries: string;
    passportNumber: string;
  }[] = [
    {
      phone: '+998901010011',
      firstName: 'Otabek',
      lastName: 'Tuychiyev',
      rating: '4.96',
      trips: 52,
      plate: '40 GAA 101',
      plateRegionCode: '40',
      makeModel: 'Chevrolet Cobalt',
      vehicleYear: 2021,
      vehicleColor: "Kulrang",
      passportSeries: 'IA',
      passportNumber: '1010101',
    },
    {
      phone: '+998901010012',
      firstName: 'Jasurbek',
      lastName: 'Mirzayev',
      rating: '4.94',
      trips: 47,
      plate: '90 GBB 202',
      plateRegionCode: '90',
      makeModel: 'Chevrolet Lacetti',
      vehicleYear: 2019,
      vehicleColor: 'Kumush',
      passportSeries: 'IA',
      passportNumber: '2020202',
    },
    {
      phone: '+998901010013',
      firstName: 'Sardor',
      lastName: 'Normatov',
      rating: '4.91',
      trips: 41,
      plate: '40 GCC 303',
      plateRegionCode: '40',
      makeModel: 'Chevrolet Nexia 3',
      vehicleYear: 2020,
      vehicleColor: 'Oq',
      passportSeries: 'AA',
      passportNumber: '3030303',
    },
    {
      phone: '+998901010014',
      firstName: 'Dilshod',
      lastName: 'Abdullayev',
      rating: '4.88',
      trips: 36,
      plate: '40 DDD 404',
      plateRegionCode: '40',
      makeModel: 'Ravon R4',
      vehicleYear: 2018,
      vehicleColor: 'Qora',
      passportSeries: 'AA',
      passportNumber: '4040404',
    },
    {
      phone: '+998901010015',
      firstName: 'Farrux',
      lastName: 'Saidov',
      rating: '4.85',
      trips: 31,
      plate: '40 EEE 505',
      plateRegionCode: '40',
      makeModel: 'Chevrolet Cobalt',
      vehicleYear: 2022,
      vehicleColor: 'Moviy',
      passportSeries: 'FA',
      passportNumber: '5050505',
    },
    {
      phone: '+998901010016',
      firstName: 'Bobur',
      lastName: 'Rahimov',
      rating: '4.82',
      trips: 27,
      plate: '40 FFF 606',
      plateRegionCode: '40',
      makeModel: 'Chevrolet Tracker',
      vehicleYear: 2023,
      vehicleColor: 'Qizil',
      passportSeries: 'FA',
      passportNumber: '6060606',
    },
    {
      phone: '+998901010017',
      firstName: 'Shohjahon',
      lastName: 'Ergashev',
      rating: '4.79',
      trips: 23,
      plate: '40 GGG 707',
      plateRegionCode: '40',
      makeModel: 'BYD Song Plus',
      vehicleYear: 2024,
      vehicleColor: 'Oq',
      passportSeries: 'IA',
      passportNumber: '7070707',
    },
    {
      phone: '+998901010018',
      firstName: "Ulug'bek",
      lastName: 'Qosimov',
      rating: '4.76',
      trips: 18,
      plate: '40 HHH 808',
      plateRegionCode: '40',
      makeModel: 'Chevrolet Damas',
      vehicleYear: 2017,
      vehicleColor: 'Oq',
      passportSeries: 'AA',
      passportNumber: '8080808',
    },
    {
      phone: '+998901010019',
      firstName: 'Azizbek',
      lastName: 'Karimov',
      rating: '4.73',
      trips: 14,
      plate: '40 III 909',
      plateRegionCode: '40',
      makeModel: 'Chevrolet Spark',
      vehicleYear: 2019,
      vehicleColor: "Sariq",
      passportSeries: 'IA',
      passportNumber: '9090909',
    },
    {
      phone: '+998901010020',
      firstName: 'Jamshid',
      lastName: 'Toshev',
      rating: '4.70',
      trips: 10,
      plate: '40 JJJ 010',
      plateRegionCode: '40',
      makeModel: 'Chevrolet Nexia 3',
      vehicleYear: 2020,
      vehicleColor: 'Kulrang',
      passportSeries: 'FA',
      passportNumber: '0101010',
    },
  ];

  const FN_POOL = [
    'Otabek',
    'Jasurbek',
    'Sardor',
    'Dilshod',
    'Farrux',
    'Bobur',
    'Shohjahon',
    "Ulug'bek",
    'Azizbek',
    'Jamshid',
    'Sanjar',
    'Behzod',
    'Rustam',
    'Odil',
    'Javohir',
  ];
  const LN_POOL = [
    'Tuychiyev',
    'Mirzayev',
    'Normatov',
    'Abdullayev',
    'Saidov',
    'Rahimov',
    'Ergashev',
    'Qosimov',
    'Karimov',
    'Toshev',
    'Ismoilov',
    'Yuldashev',
    'Olimov',
    'G‘aniyev',
    'Xoliqov',
  ];
  // 40 generated + 10 hand-crafted = 50. For reactive tests we want more volume → generate up to 100 total.
  for (let idx = 11; idx <= 100; idx++) {
    const trips = Math.max(5, 105 - idx * 2);
    const ri = (idx * 17) % 100;
    const rating = (4.52 + ri / 200).toFixed(2);
    const plate = `40 ${String.fromCharCode(65 + (idx % 26))}${String.fromCharCode(65 + ((idx * 3) % 26))}${String.fromCharCode(65 + ((idx * 5) % 26))} ${(100 + idx).toString().slice(-3)}`;
    MOCK_CHAMPION_DRIVERS.push({
      phone: `+99890103${String(idx).padStart(4, '0')}`,
      firstName: FN_POOL[idx % FN_POOL.length]!,
      lastName: `${LN_POOL[idx % LN_POOL.length]!} ${idx}`,
      rating,
      trips,
      plate,
      plateRegionCode: '40',
      makeModel: idx % 3 === 0 ? 'Chevrolet Cobalt' : idx % 3 === 1 ? 'Chevrolet Nexia 3' : 'Ravon R4',
      vehicleYear: 2017 + (idx % 8),
      vehicleColor: ['Kulrang', 'Oq', 'Qora', 'Moviy', 'Kumush'][idx % 5]!,
      passportSeries: ['IA', 'AA', 'FA'][idx % 3]!,
      passportNumber: `${idx}${idx}${idx}${idx}${idx}${idx}${idx}`,
    });
  }

  let tripSeq = 0;
  const totalTripsPlanned = MOCK_CHAMPION_DRIVERS.reduce((acc, d) => acc + d.trips, 0);
  for (let i = 0; i < MOCK_CHAMPION_DRIVERS.length; i++) {
    const md = MOCK_CHAMPION_DRIVERS[i]!;
    const userId = seedUuid(`champions-user-${md.phone}`);
    const driverId = seedUuid(`champions-driver-${md.phone}`);
    const vehicleId = seedUuid(`champions-vehicle-${md.phone}`);

    await prisma.user.upsert({
      where: { phone: md.phone },
      create: {
        id: userId,
        phone: md.phone,
        role: UserRole.DRIVER,
        status: UserAccountStatus.ACTIVE,
      },
      update: { status: UserAccountStatus.ACTIVE },
    });

    await prisma.driver.upsert({
      where: { userId },
      create: {
        id: driverId,
        userId,
        serviceZoneId: IDS.zoneGallaorol,
        operationalStatus: DriverOperationalStatus.OFFLINE,
        onboardingStatus: DriverOnboardingStatus.APPROVED,
        appActivatedAt: now,
        firstName: md.firstName,
        lastName: md.lastName,
        ratingAvg: new Prisma.Decimal(md.rating),
        passportSeries: md.passportSeries,
        passportNumber: md.passportNumber,
        adminNotes: `[seed-mock] G'allaorol demo — leaderboard test (keyin o'chirish mumkin).`,
      },
      update: {
        serviceZoneId: IDS.zoneGallaorol,
        firstName: md.firstName,
        lastName: md.lastName,
        ratingAvg: new Prisma.Decimal(md.rating),
        passportSeries: md.passportSeries,
        passportNumber: md.passportNumber,
        onboardingStatus: DriverOnboardingStatus.APPROVED,
        adminNotes: `[seed-mock] G'allaorol demo — leaderboard test (keyin o'chirish mumkin).`,
      },
    });

    await prisma.vehicle.upsert({
      where: { id: vehicleId },
      create: {
        id: vehicleId,
        driverId,
        serviceZoneId: IDS.zoneGallaorol,
        plate: md.plate,
        plateRegionCode: md.plateRegionCode,
        makeModel: md.makeModel,
        year: md.vehicleYear,
        color: md.vehicleColor,
        isActive: true,
      },
      update: {
        plate: md.plate,
        plateRegionCode: md.plateRegionCode,
        makeModel: md.makeModel,
        year: md.vehicleYear,
        color: md.vehicleColor,
        serviceZoneId: IDS.zoneGallaorol,
        isActive: true,
      },
    });

    for (let t = 0; t < md.trips; t++) {
      const frac = (tripSeq + 0.5) / Math.max(1, totalTripsPlanned);
      tripSeq += 1;
      const rawTs = monthStart.getTime() + Math.floor(frac * windowMs);
      const endedAt = new Date(Math.min(rawTs, effectiveEnd.getTime()));
      const orderId = seedUuid(`champions-order-${md.phone}-${t}`);
      const tripId = seedUuid(`champions-trip-${md.phone}-${t}`);

      await prisma.order.create({
        data: {
          id: orderId,
          serviceZoneId: IDS.zoneGallaorol,
          status: OrderStatus.COMPLETED,
          customerPhone: `+998902${String(i).padStart(2, '0')}${String(t).padStart(5, '0')}`,
          pickupLandmark: `[seed-mock] G'allaorol · ${md.firstName} ${md.lastName} · ${md.plate} · safar ${t + 1}`,
          dropoffText: 'Mock yakun (chempionlar testi)',
          paymentType: 'CASH',
          fareMode: 'METERED',
          assignedDriverId: driverId,
          trip: {
            create: {
              id: tripId,
              driverId,
              status: TripStatus.COMPLETED,
              startedAt: new Date(endedAt.getTime() - 18 * 60 * 1000),
              endedAt,
              grossUzs: new Prisma.Decimal(28000 + (t % 7) * 500),
              commissionUzs: new Prisma.Decimal(2800 + (t % 7) * 50),
              netUzs: new Prisma.Decimal(25200 + (t % 7) * 450),
              finalFareUzs: new Prisma.Decimal(28000 + (t % 7) * 500),
            },
          },
        },
      });
    }
  }

  const mockTripCount = MOCK_CHAMPION_DRIVERS.reduce((acc, d) => acc + d.trips, 0);
  // eslint-disable-next-line no-console
  console.log(
    `[seed-mock] champions demo: ${MOCK_CHAMPION_DRIVERS.length} drivers, ${mockTripCount} trips (zone G'allaorol ${IDS.zoneGallaorol}; UTC oy ${monthStart.toISOString().slice(0, 10)} … ${monthEnd.toISOString().slice(0, 10)})\n` +
      `[seed-mock] Leaderboard (oylik): real haydovchi «serviceZoneId» shu zona bilan bir xil bo‘lishi kerak (admin → haydovchi → zona = G'allaorol / gallaorol-seed).`,
  );

  await prisma.bonusCampaign.upsert({
    where: { id: 'a0000000-0000-4000-8000-000000000080' },
    create: {
      id: 'a0000000-0000-4000-8000-000000000080',
      name: 'Yakshanba — +10%',
      rules: { type: 'percent_extra', value: 10, days: [0] } as object,
      startAt: now,
      endAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
    update: {},
  });

}

main()
  .then(async () => {
    // eslint-disable-next-line no-console
    console.log('Seed OK');
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
