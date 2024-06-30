import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ChangeOrderStatusDto, CreateOrderDto, OrderPaginationDto } from './dto';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger("OrdersService"); 

  async onModuleInit() {
    await this.$connect();
    this.logger.log("Database connection started");
  }
  
  create(createOrderDto: CreateOrderDto) {
    return this.order.create({
      data: createOrderDto,
    })
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
        skip: ( currentPage - 1 ) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status,
        }
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil( totalPages / perPage)
      }
    }
  }

  async findOne(id: string) {
    const order  = await this.order.findFirst({
      where: { id },
    });
    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
       message: `Order with ID "${id}" not found`,
      });
    }
    return order
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

}
