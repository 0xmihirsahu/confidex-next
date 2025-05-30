"use client"

import { useState, useEffect } from "react"
import { ChevronDown, ArrowDown, Check } from "lucide-react"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { useAccount, useWriteContract, useReadContract } from "wagmi"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import Image from "next/image"
import axios from "axios"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDeposit } from "@/hooks/useDeposit"
import { matchingEngine } from "@/lib/matching-engine"
import { supportedChains } from "@inco/js"
import { Lightning } from "@inco/js/lite"
import { EncryptedBalance } from './EncryptedBalance'
import { Hex } from 'viem'
import cCMFAbi from '@/abi/cCMF.json'
import cUSDCAbi from '@/abi/cUSDC.json'
import approveFunctionAbi from '@/abi/approveABI.json'

export default function SwapInterface() {
  const [totalTrades, setTotalTrades] = useState(1)
  const [fromCurrency, setFromCurrency] = useState("cCMF")
  const [toCurrency, setToCurrency] = useState("cUSDC")
  const [fromAmount, setFromAmount] = useState("0.0")
  const [toAmount, setToAmount] = useState("0.0")
  const [maxDuration, setMaxDuration] = useState("Min")
  const [maxDurationValue, setMaxDurationValue] = useState("4")
  const [marketRate, setMarketRate] = useState(0)
  const [loading, setLoading] = useState(false)
  const [swappedAmount, setSwappedAmount] = useState("0.0")
  const { isConnected, address } = useAccount()
  const [swapStage, setSwapStage] = useState<
    "idle" | "depositing" | "matching" | "match_found" | "claiming"
  >("idle")

  // Setup: do it once at initialization
  const chainId = supportedChains.baseSepolia
  const zap = Lightning.latest("testnet", chainId) // Connect to Inco's latest public testnet

  const dappAddress = "0xeB1F4fd5B3A49ea9569edDD3f12cfABbFAeb42Bc" // Put your contract address here

  const currencies = ["cCMF", "cUSDC"]
  //   const timeUnits = ["Min", "Hour", "Day"];

  const tokenAddressMap: Record<string, `0x${string}`> = {
    cCMF: "0x144481927c78798B5C38890c2E8E777dE27Dfc97",
    cUSDC: "0x1bC80Bcc4fBB107FCF65D09e84d4c6Ff5E0B9e7B",
  }

  // Replace useBalance with useContractRead
  const { data: fromEncryptedBalance, isError: fromError } = useReadContract({
    address: tokenAddressMap[fromCurrency],
    abi: fromCurrency === 'cCMF' ? cCMFAbi : cUSDCAbi,
    functionName: 'balanceOf',
    args: [address],
  })

  const { data: toEncryptedBalance, isError: toError } = useReadContract({
    address: tokenAddressMap[toCurrency],
    abi: toCurrency === 'cCMF' ? cCMFAbi : cUSDCAbi,
    functionName: 'balanceOf',
    args: [address],
  })

//   // Add debug logs
//   console.log('From Encrypted Balance:', {
//     balance: fromEncryptedBalance,
//     error: fromError,
//     currency: fromCurrency,
//     address: tokenAddressMap[fromCurrency]
//   })
//   console.log('To Encrypted Balance:', {
//     balance: toEncryptedBalance,
//     error: toError,
//     currency: toCurrency,
//     address: tokenAddressMap[toCurrency]
//   })

  // Calculate total balance including swapped amount
//   const totalToBalance = toEncryptedBalance
//     ? (parseFloat(toEncryptedBalance.toString()) + parseFloat(swappedAmount)).toFixed(6)
//     : swappedAmount

  const handleSwap = () => {
    if (!isConnected) return

    // Swap currencies and amounts
    setFromCurrency(toCurrency)
    setToCurrency(fromCurrency)
    setFromAmount(toAmount)
    setToAmount(fromAmount)
  }

  const { depositTokens } = useDeposit({
    tokenAddress: tokenAddressMap[fromCurrency],
    onDepositSuccess: () => {
      setSwapStage("matching")
      setTimeout(() => {
        setSwapStage("idle")
      }, 2000)
    },
  })

  const { writeContractAsync } = useWriteContract()
  

  const handleMainSwap = async () => {
    if (!isConnected || !address) return
    setSwapStage("depositing")
    setSwappedAmount("0.0") // Reset swapped amount at start of new swap

    try {
      // Encrypt the amount

      console.log("inside handleMainSwap")
      const plaintext = parseFloat(fromAmount) * 10 ** 18
      const encryptedAmountforApprove = await zap.encrypt(plaintext, {
        accountAddress: address,
        dappAddress: tokenAddressMap[fromCurrency],
      })

      console.log("🔐 Encrypted amount:", encryptedAmountforApprove)

      // First approve the dapp to spend tokens
      try {
        console.log("🔑 Approving tokens...")
        const approveTx = await writeContractAsync({
          address: tokenAddressMap[fromCurrency],
          abi: approveFunctionAbi as any,
          functionName: 'approve',
          args: [dappAddress, encryptedAmountforApprove],
        })
        console.log("✅ Approval transaction submitted:", approveTx)
        
        // Wait for approval transaction to be mined
        await new Promise((resolve) => setTimeout(resolve, 3000))
      } catch (approveError) {
        console.error("❌ Approval failed:", approveError)
        throw approveError
      }

      const encryptedAmountforDeposit = await zap.encrypt(plaintext, {
        accountAddress: address,
        dappAddress,
      })

      // Now use the encrypted amount for deposit
      const txHash = await depositTokens?.(encryptedAmountforDeposit)
      if (txHash) {
        console.log("✅ Deposit transaction submitted:", txHash)
        await matchingEngine.initiateDeposit(txHash)

        // Simulate deposit confirmation with longer delay
        setTimeout(async () => {
          await matchingEngine.depositConfirmed()
          setSwapStage("matching")

          // Simulate intent submission with longer delay
          setTimeout(async () => {
            await matchingEngine.intentsSubmitted()

            // Simulate finding matches and completing swap with longer delays
            setTimeout(async () => {
              await matchingEngine.matchesFound()
              setSwapStage("match_found")

              // Add delay before sending tokens
              setTimeout(async () => {
                await matchingEngine.tokensSent()
                setSwappedAmount(toAmount) // Set the swapped amount when swap completes
                setSwapStage("idle")
              }, 3000)
            }, 4000)
          }, 9500)
        }, 3000)

        try {
          console.log("🔄 Submitting intent with data:", {
            user: address,
            fromToken: tokenAddressMap[fromCurrency],
            toToken: tokenAddressMap[toCurrency],
            amount: fromAmount,
            receive: toAmount,
            expiryTime: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
          })

          // Add 3 second delay before sending the request
          await new Promise((resolve) => setTimeout(resolve, 4000))
          console.log(".")

          const response = await axios.post(
            "http://localhost:3000/intent/submit",
            {
              user: address,
              fromToken: tokenAddressMap[fromCurrency],
              toToken: tokenAddressMap[toCurrency],
              amount: fromAmount,
              receive: toAmount,
              expiryTime: new Date(Date.now() + 3 * 60 * 1000).toISOString(), // 3 minutes from now
            }
          )

          console.log("✅ Intent submission successful:", response.data)
        } catch (error) {
          console.error("❌ Intent submission failed:", error)
          if (axios.isAxiosError(error)) {
            console.error("Axios error details:", {
              status: error.response?.status,
              statusText: error.response?.statusText,
              data: error.response?.data,
            })
          }
          throw error // Re-throw to be caught by the outer try-catch
        }
      } else {
        console.warn("⚠️ depositTokens returned undefined.")
        await matchingEngine.depositFailed("Transaction failed to submit")
        setSwapStage("idle")
      }
    } catch (err) {
      console.error("❌ Deposit failed:", err)
      await matchingEngine.depositFailed(
        err instanceof Error ? err.message : "Unknown error"
      )
      setSwapStage("idle")
    }
  }

  const getButtonText = () => {
    if (!isConnected) return "Connect Your Wallet"
    switch (swapStage) {
      case "depositing":
        return "Depositing..."
      case "matching":
        return "Matching..."
      case "match_found":
        return "Match Found!"
      case "claiming":
        return "Claiming..."
      default:
        return "Swap"
    }
  }

  const getButtonDisabled = () => {
    return !isConnected || swapStage !== "idle"
  }

  const getButtonClassName = () => {
    const baseClasses =
      "w-full text-white font-bold py-4 px-6 rounded-none mt-0 transition-colors"
    if (!isConnected) {
      return `${baseClasses} bg-blue-600 hover:bg-blue-600/90`
    }

    switch (swapStage) {
      case "depositing":
      case "matching":
      case "match_found":
      case "claiming":
        return `${baseClasses} bg-blue-600 opacity-50 cursor-not-allowed`
      default:
        return `${baseClasses} bg-blue-600 hover:bg-blue-600/90`
    }
  }

  const getMarketRate = async () => {
    setLoading(true)
    try {
      const response = await axios.get(
        `/api/get-market-rate?fromToken=${fromCurrency}&toToken=${toCurrency}`
      )
      setMarketRate(response.data.rate)
      // Update toAmount based on current fromAmount and new rate
      if (parseFloat(fromAmount) > 0) {
        const newToAmount = (
          parseFloat(fromAmount) * response.data.rate
        ).toFixed(6)
        setToAmount(newToAmount)
      }
    } catch (error) {
      console.error("Error fetching market rate:", error)
    } finally {
      setLoading(false)
    }
  }

  // Update toAmount whenever fromAmount changes
  useEffect(() => {
    if (parseFloat(fromAmount) > 0 && marketRate > 0) {
      const newToAmount = (parseFloat(fromAmount) * marketRate).toFixed(6)
      setToAmount(newToAmount)
    } else {
      setToAmount("0.0")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAmount, marketRate])

  // Fetch initial market rate
  useEffect(() => {
    getMarketRate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromCurrency, toCurrency])

  const getTokenLogo = (currency: string) => {
    if (currency === "Patty") {
      return (
        <Image
          src="/patty.png"
          alt="Patty"
          className={`w-6 h-6`}
          width={24}
          height={24}
        />
      )
    } else if (currency === "Cheese") {
      return (
        <Image
          src="/cheese.svg"
          alt="Cheese"
          className={`w-6 h-6`}
          width={24}
          height={24}
        />
      )
    } else {
      return (
        <Image
          src="/lettuce.svg"
          alt="Lettuce"
          className={`w-6 h-6`}
          width={24}
          height={24}
        />
      )
    }
  }

  return (
    <div className="max-w-md w-full space-y-4">
      {/* Swap Card */}
      <div className="bg-gradient-to-br backdrop-blur-sm from-blue-600/5 to-blue-500/5 rounded-none p-5 shadow-lg border border-blue-600/20">
        {/* From Section */}
        <div className="mb-4">
          <div className="flex justify-between mb-2">
            <p className="text-blue-600">From</p>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Balance:</span>
              {fromEncryptedBalance && address ? (
                <div>
                  <EncryptedBalance 
                    encryptedBalance={fromEncryptedBalance as Hex} 
                    tokenSymbol={fromCurrency} 
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div className="bg-gradient-to-r from-blue-600/10 to-blue-500/10 rounded-none p-4 flex items-center justify-between border border-blue-600/20 hover:border-blue-500/20 transition-colors">
            <div className="flex items-center">
              <div className={`bg-white rounded-full p-2 mr-2`}>
                <div className="w-6 h-6 flex items-center justify-center">
                  {getTokenLogo(fromCurrency)}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center text-blue-600 font-bold text-lg focus:outline-none">
                  {fromCurrency}
                  <ChevronDown className="ml-1 h-5 w-5 text-blue-600/70" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-white/90 text-blue-600 border-blue-600/20">
                  {currencies.map((currency) => (
                    <DropdownMenuItem
                      key={currency}
                      className="focus:bg-blue-600/20 cursor-pointer"
                      onClick={() => setFromCurrency(currency)}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 flex items-center justify-center">
                            {getTokenLogo(currency)}
                          </div>
                          {currency}
                        </div>
                        {currency === fromCurrency && (
                          <Check className="h-4 w-4 ml-2" />
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Input
              type="text"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
              className="bg-transparent border-none text-gray-300 text-2xl font-bold text-right w-24 p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center my-4">
          <button
            onClick={handleSwap}
            className="bg-gradient-to-r from-blue-600/10 to-blue-500/10 p-1 rounded-none border border-blue-600/20 hover:border-blue-500/20 hover:from-blue-600/20 hover:to-blue-500/20 transition-all"
          >
            <ArrowDown className="h-6 w-6 text-blue-600" />
          </button>
        </div>

        {/* To Section */}
        <div className="mb-4">
          <div className="flex justify-between mb-2">
            <p className="text-blue-600">To</p>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Balance:</span>
              {toEncryptedBalance && address ? (
                <div>
                  <EncryptedBalance 
                    encryptedBalance={toEncryptedBalance as Hex} 
                    tokenSymbol={toCurrency} 
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div className="bg-gradient-to-r from-blue-600/10 to-blue-500/10 rounded-none p-4 flex items-center justify-between border border-blue-600/20 hover:border-blue-500/20 transition-colors">
            <div className="flex items-center">
              <div className={`bg-white rounded-full p-2 mr-2`}>
                <div className="w-6 h-6 flex items-center justify-center">
                  {getTokenLogo(toCurrency)}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center text-blue-600 font-bold text-lg focus:outline-none">
                  {toCurrency}
                  <ChevronDown className="ml-1 h-5 w-5 text-blue-600/70" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-white/90 text-blue-600 border-blue-600/20">
                  {currencies.map((currency) => (
                    <DropdownMenuItem
                      key={currency}
                      className="focus:bg-blue-600/20 cursor-pointer"
                      onClick={() => setToCurrency(currency)}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 flex items-center justify-center">
                            {getTokenLogo(currency)}
                          </div>
                          {currency}
                        </div>
                        {currency === toCurrency && (
                          <Check className="h-4 w-4 ml-2" />
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Input
              type="text"
              value={toAmount}
              onChange={(e) => setToAmount(e.target.value)}
              className="bg-transparent border-none text-gray-300 text-2xl font-bold text-right w-24 p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
        </div>

        {/* Rate Display */}
        <div className="flex justify-between mb-4">
          <span className="text-blue-600">Sell {fromCurrency} at rate</span>
          <button
            onClick={getMarketRate}
            disabled={loading}
            className="text-blue-500 cursor-pointer hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Loading..." : "Set market rate"}
          </button>
        </div>

        {/* Rate Card */}
        <div className="flex">
          <div className="bg-gradient-to-r from-blue-600/10 to-blue-500/10 rounded-none p-4 flex-1 border border-blue-600/20">
            <span className="text-blue-600 block">{toCurrency}</span>
            <div className="flex items-baseline">
              <span className="text-blue-600 text-xl font-bold">
                {marketRate.toFixed(6)}
              </span>
              <span className="text-blue-500/70 text-sm ml-2">
                ~{(marketRate * 2.63).toFixed(2)} USD
              </span>
            </div>
          </div>
          <div className="bg-gradient-to-r from-blue-600/10 to-blue-500/10 rounded-none p-4 flex-1 border border-blue-600/20 border-l-0">
            <span className="text-blue-600 block">Min Amount</span>
            <span className="text-blue-600 text-xl font-bold">
              {(
                parseFloat(toAmount) *
                (1 - (Math.random() * 0.007 + 0.004))
              ).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Trade Settings Card */}
      <div className="bg-gradient-to-br backdrop-blur-sm from-blue-600/5 to-blue-500/5 rounded-none p-5 shadow-lg border border-blue-600/20">
        {/* Total Trades */}
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-blue-600">Expiry</span>
            <span className="text-blue-600 font-bold">
              {totalTrades} {maxDuration}
            </span>
          </div>
          <div className="flex items-center">
            <div className="mr-4">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
                  fill="blue"
                />
                <path
                  d="M12 6V12L16 14"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <Slider
              defaultValue={[totalTrades]}
              min={1}
              max={5}
              step={1}
              onValueChange={(value) => setTotalTrades(value[0])}
              className="flex-1"
            />
          </div>
        </div>

        {/* Connect Wallet Button */}
        <button
          className={getButtonClassName()}
          onClick={handleMainSwap}
          disabled={getButtonDisabled()}
        >
          {getButtonText()}
        </button>
      </div>
    </div>
  )
}
