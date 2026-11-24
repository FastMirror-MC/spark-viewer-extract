import { useCallback, useState } from 'react';
import { SocketClientHook } from '../../common/hooks/useSocketClient';
import useSocketListener from '../../common/hooks/useSocketListener';
import { ListenerResult } from '../../common/ws/Listener';
import { PlatformStatistics, SamplerMetadata } from '../../proto/spark_pb';

export interface SocketBindingsProps {
    socket: SocketClientHook;
    fetchUpdatedData: (payloadId: string) => void;
    metadata: SamplerMetadata;
    setMetadata: (metadata: SamplerMetadata) => void;
}

export interface SocketBinding {
    socket: SocketClientHook;
    lastStatsUpdate?: number;
    lastSamplerUpdate?: number;
}

export default function useSocketBindings({
    socket,
    fetchUpdatedData,
    metadata,
    setMetadata,
}: SocketBindingsProps): SocketBinding {
    const [lastStatsUpdate, setLastStatsUpdate] = useState<number>();
    const [lastSamplerUpdate, setLastSamplerUpdate] = useState<number>();

    useSocketListener(
        socket.socket,
        useCallback(
            packet => {
                if (packet.oneofKind === 'serverUpdateStatistics') {
                    const { platform, system, metrics } =
                        packet.serverUpdateStatistics;

                    const platformWithWorld = {
                        ...platform,
                        world: metadata.platformStatistics?.world,
                    } as PlatformStatistics;

                    const newMetadata: SamplerMetadata = {
                        ...metadata,
                        platformStatistics: platformWithWorld,
                        systemStatistics: system,
                        metrics: metrics,
                    };
                    setMetadata(newMetadata);
                    setLastStatsUpdate(Date.now());
                }

                if (packet.oneofKind === 'serverUpdateSampler') {
                    const payloadId = packet.serverUpdateSampler.payloadId;
                    fetchUpdatedData(payloadId);
                    setLastSamplerUpdate(Date.now());
                }

                return ListenerResult.KEEP_LISTENING;
            },
            [metadata, setMetadata, fetchUpdatedData]
        )
    );

    return {
        socket,
        lastStatsUpdate,
        lastSamplerUpdate,
    };
}
