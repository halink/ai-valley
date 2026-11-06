export type DutyRole = 'kitchen' | 'care';

export interface PublicDutyAction {
  type: 'publicDuty';
  operation: 'claim' | 'decline' | 'reschedule' | 'withdraw' | 'attend' | 'stay' | 'receive';
  shiftId: string;
  fromShiftId?: string;
}

export interface DutyAssignment {
  residentId: string;
  acceptedAt: number;
  arrivedAt: number | null;
  leftAt: number | null;
  wagesPaid?: number;
  outcome?: 'withdrew' | 'absent' | 'left' | 'finished' | 'rescheduled';
}

export interface PublicShift {
  id: string;
  role: DutyRole;
  buildingId: string;
  start: number;
  end: number;
  workerId: string | null;
  status: 'open' | 'booked' | 'on-duty' | 'finished' | 'unfilled';
  assignments: DutyAssignment[];
  funding?: {budgetId:string;wagePerService:number;wageAccount:string;reserved:number;paid:number;closed?:boolean};
  declinedBy: string[];
  served: number;
  // One workstation and one resident receiving service at a time.
  clientId: string | null;
}

export interface PublicDuties {
  publishedThroughDay: number;
  shifts: PublicShift[];
}
