
import { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback } from '@klinecharts/pro';
import { KLineData } from 'klinecharts';
import { supabase } from '@/lib/supabaseClient';

export class FundingRateDatafeed implements Datafeed {
    private subscribers: Map<string, { callback: DatafeedSubscribeCallback, channel: any }> = new Map();

    /**
     * Fuzzy search symbols
     */
    async searchSymbols(search?: string): Promise<SymbolInfo[]> {
        // For now, return static symbols. In future, we could search DB.
        const symbols: SymbolInfo[] = [
            {
                ticker: 'BTC',
                name: 'Bitcoin',
                shortName: 'BTC',
                exchange: 'CONSENSUS',
                market: 'crypto',
                priceCurrency: 'apr',
                type: 'index',
                pricePrecision: 2
            },
            {
                ticker: 'ETH',
                name: 'Ethereum',
                shortName: 'ETH',
                exchange: 'CONSENSUS',
                market: 'crypto',
                priceCurrency: 'apr',
                type: 'index',
                pricePrecision: 2
            }
        ];

        if (search) {
            return symbols.filter(s =>
                s.ticker.toLowerCase().includes(search.toLowerCase()) ||
                (s.name || '').toLowerCase().includes(search.toLowerCase())
            );
        }
        return symbols;
    }

    /**
     * Pull historical k-line data
     */
    async getHistoryKLineData(symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
        const { data: rows, error } = await supabase
            .from('funding_rates')
            .select('*')
            .eq('asset_symbol', symbol.ticker)
            // Filter by time range if possible, or just limit
            .gte('timestamp', new Date(from).toISOString())
            .lte('timestamp', new Date(to).toISOString())
            .order('timestamp', { ascending: true });

        if (error) {
            console.error("Datafeed Error:", error);
            // Return empty array or handle error
            return [];
        }

        if (!rows || rows.length === 0) {
            return [];
        }

        const candles: KLineData[] = [];
        let currentCandle: KLineData | null = null;

        // Group by period (simplified: we'll assume 1-minute intervals for now from DB)
        // Adjust aggregation logic based on `period` if needed.
        // For this MVP, we map each row to a candle if it mimics high-freq data,
        // or aggregate if we want strict period adherence.

        rows.forEach((row: any) => {
            const time = new Date(row.timestamp).getTime();

            // Use median_apr as the "price"
            const val = row.median_apr ?? 0;

            // Mock OHLC from single value + volatility for visual appeal if needed,
            // or just flat line if real data calls for it. 
            // Existing chart had mock volatility, let's keep it simple for now:

            candles.push({
                timestamp: time,
                open: val,
                high: val,
                low: val,
                close: val,
                volume: Math.random() * 100 // Mock volume
            });
        });

        return candles;
    }

    /**
     * Subscribe to real-time data
     */
    subscribe(symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
        const channelId = `chart_${symbol.ticker}_${Date.now()}`;

        const channel = supabase
            .channel(channelId)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'funding_rates', filter: `asset_symbol=eq.${symbol.ticker}` },
                (payload) => {
                    const newRow = payload.new as any;
                    const time = new Date(newRow.timestamp).getTime();
                    const val = newRow.median_apr ?? 0;

                    const kLineData: KLineData = {
                        timestamp: time,
                        open: val,
                        high: val,
                        low: val,
                        close: val,
                        volume: Math.random() * 10
                    };

                    callback(kLineData);
                }
            )
            .subscribe();

        this.subscribers.set(`${symbol.ticker}_${period.text}`, { callback, channel });
    }

    /**
     * Unsubscribe
     */
    unsubscribe(symbol: SymbolInfo, period: Period): void {
        const key = `${symbol.ticker}_${period.text}`;
        const sub = this.subscribers.get(key);
        if (sub) {
            supabase.removeChannel(sub.channel);
            this.subscribers.delete(key);
        }
    }
}
