import { z } from 'zod';
import { refId } from '../ids.js';
import { exprSchema, gameIdSchema, textKeySchema } from './common.js';

/**
 * 商店定义（设计 §2.4 ShopDef；data/shops.yaml，FR-ECON-02）。
 *
 * - priceBuy/priceSell 为定价表达式：加载期编译，每次求值注入当前状态
 *   （声望/时段/周目/好感即普通变量，§5.3）；
 * - stock 库存计数 + restock 补货周期（day_rollover 补货，§4.3 步骤 4）；
 *   无限库存省略 stock；requireFlag 为商店开放条件（flag 名，加载期校验存在性）；
 * - currency 声明交易货币（多货币钱包的键，FR-ECON-01）。
 */

export const shopEntrySchema = z.strictObject({
  item: refId('item'),
  /** 商品显示条件 */
  showIf: exprSchema.optional(),
  /** 初始库存（缺省 = 无限） */
  stock: z.number().int().min(0).optional(),
  /** 补货周期（时段数，缺省 = 不补货） */
  restock: z.number().int().min(0).optional(),
});

export type ShopEntry = z.infer<typeof shopEntrySchema>;

export const shopDefSchema = z.strictObject({
  id: gameIdSchema,
  nameKey: textKeySchema,
  entries: z.array(shopEntrySchema).min(1),
  /** 买价表达式（玩家支付的货币数量） */
  priceBuy: exprSchema,
  /** 卖价表达式（回购：当次交易内回购价 = 本次卖价，FR-ECON-03） */
  priceSell: exprSchema,
  /** 交易货币 id（缺省 = 游戏首个货币） */
  currency: gameIdSchema.optional(),
  /** 商店开放所需 flag 名（缺省 = 恒开放） */
  requireFlag: z.string().min(1).optional(),
});

export type ShopDef = z.infer<typeof shopDefSchema>;
