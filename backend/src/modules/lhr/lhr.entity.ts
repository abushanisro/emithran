import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('lhr_records')
export class LHR {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  labourCode: string;

  @Column({ length: 100 })
  labourType: string;

  @Column('text')
  description: string;

  @Column('decimal', { precision: 10, scale: 2 })
  minimumWagePerDay: number;

  @Column('decimal', { precision: 10, scale: 2 })
  minimumWagePerMonth: number;

  @Column('decimal', { precision: 10, scale: 2 })
  dearnessAllowance: number;

  @Column('decimal', { precision: 5, scale: 2 })
  perksPercentage: number;

  @Column('decimal', { precision: 10, scale: 2 })
  lhr: number; // Labour Hour Rate

  @Column({ length: 255, nullable: true })
  reference: string;

  @Column({ length: 100, default: 'India - Bangalore' })
  location: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
