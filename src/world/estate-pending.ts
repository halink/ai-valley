import {hasCultureAssets} from './culture.js';
import {hasHouseholdAssets} from './household.js';
import type {World} from '../shared/types.js';import {hasEmploymentAssets} from './employment.js';import {hasForeignAssets} from './foreign-trade.js';import {hasIndustryAssets} from './industry.js';import {hasLongCareAssets} from './long-care.js';import {hasHealthAssets} from './health.js';import {hasEducationAssets} from './education.js';import {hasConstructionAssets} from './construction.js';
/** Resolve property already owed to the estate before dividing it or closing cash-only liabilities. */
export function pendingEstateReturns(w:World,id:string):string|null {
 if(hasCultureAssets(w,id))return '逝者留在文化活动现场的未用物资尚待实际保全';
 if(hasHouseholdAssets(w,id))return '逝者的共用资金与储物份额须先在原处实际保全，不能提前分配遗产或结清现金债务';
 if(w.economy?.businesses.some(b=>b.ownerId===id&&b.closedAt===null))return '逝者的经营财产尚待完成封存清点';
 if(hasEmploymentAssets(w,id)||hasForeignAssets(w,id))return '逝者的工资约定或在途外贸财产尚待结算，须先保全相关人的权利';
 if(hasIndustryAssets(w,id))return '逝者未完成加工的实际原料尚待保全';
 if(hasLongCareAssets(w,id))return '逝者长期照护预付款尚待保全与结清';
 if(hasHealthAssets(w,id))return '逝者的诊疗预付款或药剂保留尚待结清';
 if(hasEducationAssets(w,id))return '逝者的学费预留尚待退回或结清';
 if(hasConstructionAssets(w,id))return '逝者的工程资助、工资或未用材料尚待保全结算';return null;
}
