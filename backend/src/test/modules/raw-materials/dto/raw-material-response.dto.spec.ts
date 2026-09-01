import { RawMaterialResponseDto } from '../../../../modules/raw-materials/dto/raw-material-response.dto';

describe('RawMaterialResponseDto.fromDatabase — currency labeling', () => {
  it('labels a cost_india-sourced value as INR, not silently USD', () => {
    const row = { id: '1', material: 'SS304', cost_india: '175', cost: null, currency: null };
    const dto = RawMaterialResponseDto.fromDatabase(row);
    expect(dto.unitCost).toBe(175);
    expect(dto.currency).toBe('INR');
  });

  it('labels a cost-only (legacy INR column) value as INR when currency is null', () => {
    const row = { id: '2', material: 'Mild Steel', cost_india: null, cost: '62', currency: null };
    const dto = RawMaterialResponseDto.fromDatabase(row);
    expect(dto.unitCost).toBe(62);
    expect(dto.currency).toBe('INR');
  });

  it('respects an explicitly-recorded non-INR currency instead of overriding it', () => {
    const row = { id: '3', material: 'Imported Alloy', cost_india: '5000', cost: null, currency: 'USD' };
    const dto = RawMaterialResponseDto.fromDatabase(row);
    expect(dto.currency).toBe('USD');
  });

  it('leaves currency undefined (not a guessed default) when there is no cost value at all', () => {
    const row = { id: '4', material: 'Unpriced Material', cost_india: null, cost: null, currency: null };
    const dto = RawMaterialResponseDto.fromDatabase(row);
    expect(dto.unitCost).toBeUndefined();
    expect(dto.currency).toBeUndefined();
  });
});
