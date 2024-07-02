import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ChangeOrderStatusDto, CreateOrderDto, OrderPaginationDto, PaidOrderDto } from './dto';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { NATS_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';
import { OrderWithProducts } from './interfaces/order-with-products.interface';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger("OrdersService");

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log("Database connection started");
  }

  async create(createOrderDto: CreateOrderDto) {

    try {

      // Validate products first
      const productIds = createOrderDto.items.map(item => item.productId);
      const products: any[] = await firstValueFrom(
        this.client.send({
          cmd: "validate_products"
        },
          productIds
        )
      )

      //Item Calculations
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(
          product => product.id === orderItem.productId,
        ).price;
        return acc + (price * orderItem.quantity);
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity
      }, 0);

      //db transaction
      const order = await this.order.create({
        data: {
          totalAmmount: totalAmount,
          totalItems: totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map(orderItem => ({
                productId: orderItem.productId,
                quantity: orderItem.quantity,
                price: products.find(
                  product => product.id === orderItem.productId,
                ).price
              }))
            }
          }
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            }
          }
        }
      });
      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find(product => product.id === orderItem.productId).name
        }))
      };

    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: "Error validating products",
      })
    }
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {

    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status,
      }
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit;

    return {
      data: await this.order.findMany({
        skip: (currentPage - 1) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status,
        }
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil(totalPages / perPage)
      }
    }
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          }
        }
      },
    });
    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with ID "${id}" not found`,
      });
    }

    const productIds = order.OrderItem.map(orderItem => orderItem.productId);
    const products: any[] = await firstValueFrom(
      this.client.send({
        cmd: "validate_products"
      },
        productIds
      )
    )

    return {
      ...order,
      OrderItem: order.OrderItem.map((orderItem) => ({
        ...orderItem,
        name: products.find(product => product.id === orderItem.productId).name
      }))
    }
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;
    const order = await this.findOne(id);

    //Si queremos que quede el cambio en updatedAt de la DB quitar esto:
    if (order.status === status) {
      return order;
    }

    return this.order.update({
      where: { id },
      data: {
        status: status
      },
    });

  }

  async createPaymentSession(order: OrderWithProducts) {
    const paymentSession = await firstValueFrom(
      this.client.send(
        "create.payment.session",
        {
          orderId: order.id,
          currency: "usd",
          items: order.OrderItem.map(item => ({
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          }))
        }
      )
    );
    return paymentSession;
  }

  async validatePayment(paidOrderDto: PaidOrderDto) {
    this.logger.log("paidorder")
    this.logger.log(paidOrderDto)
    const updatedOrder = await this.order.update({
      where: {
        id: paidOrderDto.orderId
      },
      data: {
        status: "PAID",
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripePaymentId,

        OrderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl
          }
        }
      }
    });
    return updatedOrder;
  }
}
