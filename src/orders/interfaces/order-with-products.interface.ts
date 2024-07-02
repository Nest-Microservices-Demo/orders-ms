import { OrderStatus } from "@prisma/client";

export interface OrderWithProducts {
  OrderItem: {
      name: any;
      productId: number;
      quantity: number;
      price: number;
  }[];
  id: string;
  totalAmmount: number;
  totalItems: number;
  status: OrderStatus;
  paid: boolean;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
}