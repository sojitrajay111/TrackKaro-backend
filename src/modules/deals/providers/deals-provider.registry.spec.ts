import { DealsProvider } from './deals-provider.interface';
import { DealsProviderRegistry } from './deals-provider.registry';

function fakeProvider(id: string): DealsProvider {
  return {
    id,
    displayName: id,
    isConfigured: () => true,
    search: async () => ({ status: 'ok', deals: [] }),
  };
}

describe('DealsProviderRegistry', () => {
  it('exposes every registered provider, in registration order', () => {
    const flipkart = fakeProvider('flipkart');
    const amazon = fakeProvider('amazon');
    const registry = new DealsProviderRegistry([flipkart, amazon]);

    expect(registry.getProviders()).toEqual([flipkart, amazon]);
  });

  it('resolves a provider by id', () => {
    const flipkart = fakeProvider('flipkart');
    const registry = new DealsProviderRegistry([flipkart]);

    expect(registry.getProvider('flipkart')).toBe(flipkart);
    expect(registry.getProvider('nonexistent')).toBeUndefined();
  });
});
