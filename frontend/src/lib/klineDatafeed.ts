
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
        // Query the 5-minute candlestick view
        // Columns: bucket, asset_symbol, open, high, low, close, volume
        const { data: rows, error } = await supabase
            .from('funding_candlesticks_5m')
            .select('*')
            .eq('asset_symbol', symbol.ticker)
            .gte('bucket', new Date(from).toISOString())
            .lte('bucket', new Date(to).toISOString())
            .order('bucket', { ascending: true })
            .limit(1000); // Reasonable limit for chart load

        if (error) {
            console.error("Datafeed Error:", error);
            return [];
        }

        if (!rows || rows.length === 0) {
            return [];
        }

        const candles: KLineData[] = rows.map((row: any) => ({
            timestamp: new Date(row.bucket).getTime(),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.volume)
        }));

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
